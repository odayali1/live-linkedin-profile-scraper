import { Actor, log } from 'apify';
import { createHash } from 'node:crypto';

type Input = {
    urls?: string[];
    urlsCsv?: string;
    fileUrl?: string;
    maxUrls?: number;
    concurrency?: number;
    resumeId?: string;
    freshStart?: boolean;
};

type Outcome = 'not_found' | 'failed';

const API_BASE = (process.env.CUAPI_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.CUAPI_API_KEY?.trim();
const EVENT = 'live-linkedin-profile';
const DIRECT_ATTEMPTS = 5;
const LOOKUP_TIMEOUT_MS = 60_000;
const HARD_MAX = 1_000_000;

function textOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function asRecords(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function stringsOf(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => textOrNull(item)).filter((item): item is string => !!item);
}

function yearMonth(year: unknown, month: unknown): string | null {
    const yearText = typeof year === 'number' && Number.isFinite(year)
        ? String(year)
        : textOrNull(year);
    if (!yearText) return null;
    const monthText = typeof month === 'number' && Number.isFinite(month)
        ? String(month)
        : textOrNull(month);
    const monthNumber = monthText ? Number(monthText) : NaN;
    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return yearText;
    return `${yearText}-${String(monthNumber).padStart(2, '0')}`;
}

function endLabel(start: string | null, end: string | null, current: boolean): string | null {
    if (end) return end;
    return start && current ? 'Present' : null;
}

function slugOf(raw: string): string {
    try {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        const match = url.pathname.match(/\/in\/([^/]+)/i);
        return match ? decodeURIComponent(match[1]).replace(/\/+$/, '').toLowerCase() : '';
    } catch {
        return '';
    }
}

function normalizeUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !url.pathname.toLowerCase().includes('/in/')) return null;
        const slug = decodeURIComponent(url.pathname.match(/\/in\/([^/]+)/i)?.[1] || '').replace(/\/+$/, '');
        if (!slug) return null;
        return `https://www.linkedin.com/in/${slug}`;
    } catch {
        return null;
    }
}

function parseCsv(text: string): string[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const split = (line: string) => line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
    const first = split(lines[0]).map((part) => part.toLowerCase());
    const names = ['url', 'linkedinurl', 'linkedin_url', 'profileurl', 'profile_url', 'linkedin'];
    const hasHeader = first.some((part) => names.includes(part));
    const urlIndex = hasHeader ? Math.max(first.findIndex((part) => names.includes(part)), 0) : 0;
    return lines.slice(hasHeader ? 1 : 0).map((line) => split(line)[urlIndex] || '');
}

async function collectUrls(input: Input): Promise<string[]> {
    const raw: string[] = [...(input.urls || [])];
    if (input.urlsCsv) raw.push(...parseCsv(input.urlsCsv));
    if (input.fileUrl) {
        const response = await fetch(input.fileUrl, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Could not download input file (HTTP ${response.status}).`);
        raw.push(...parseCsv(await response.text()));
    }
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of raw) {
        const url = normalizeUrl(value);
        if (!url || seen.has(url.toLowerCase())) continue;
        seen.add(url.toLowerCase());
        urls.push(url);
    }
    return urls;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : fallback;
    return message.replace(/https?:\/\/\S+/gi, 'the lookup service');
}

function permanentStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 402 || status === 403 || status === 404 || status === 409;
}

function stalled(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return error.name === 'TimeoutError' || error.name === 'AbortError' || message.includes('fetch failed') || message.includes('network') || message.includes('timed out');
}

type Lookup =
    | { kind: 'hit'; body: Record<string, unknown> }
    | { kind: 'miss' }
    | { kind: 'stop'; message: string };

async function enrichUrl(url: string): Promise<Lookup> {
    let lastError = 'Lookup failed';
    for (let attempt = 0; attempt < DIRECT_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(`${API_BASE}/v1/profiles/enrich`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mawsool-Apify-live-profile/1.0',
                    'x-api-key': API_KEY!,
                },
                body: JSON.stringify({ linkedinUrl: url }),
                signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
            });
            const text = await response.text();
            let body: Record<string, unknown> | null = null;
            try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* handled below */ }
            if (response.status === 404) return { kind: 'miss' };
            if (response.status === 401 || response.status === 402) {
                return { kind: 'stop', message: response.status === 402 ? 'The lookup service has no credits left.' : 'The lookup service rejected the API key.' };
            }
            if (response.ok && body) return { kind: 'hit', body };
            lastError = body && typeof body.error === 'string' ? body.error : `API returned HTTP ${response.status}`;
            if (permanentStatus(response.status)) break;
            log.warning(`Profile attempt ${attempt + 1} of ${DIRECT_ATTEMPTS} did not succeed. Retrying.`);
        } catch (error) {
            lastError = stalled(error) ? 'The lookup did not answer in time.' : cleanError(error, 'Network request failed');
            log.warning(`Profile attempt ${attempt + 1} of ${DIRECT_ATTEMPTS} did not succeed. Retrying.`);
        }
        if (attempt < DIRECT_ATTEMPTS - 1) await sleep(Math.min(8000, 1000 * (2 ** attempt)));
    }
    throw new Error(lastError.replace(/https?:\/\/\S+/gi, 'the lookup service'));
}

function rolesFrom(groups: unknown, status: 'Current' | 'Past'): Record<string, unknown>[] {
    return asRecords(groups).flatMap((group) => {
        const company = asRecord(group.company);
        return asRecords(group.positions).map((role) => {
            const start = yearMonth(role.startDateYear, role.startDateMonth);
            const end = yearMonth(role.endDateYear, role.endDateMonth);
            return {
                title: textOrNull(role.title),
                company: textOrNull(company?.name),
                companyUrl: textOrNull(company?.url),
                location: textOrNull(role.location),
                description: textOrNull(role.description),
                employmentType: textOrNull(role.employmentType),
                start,
                end: endLabel(start, end, status === 'Current'),
                status,
            };
        });
    });
}

function educationOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => {
        const school = asRecord(item.school);
        const start = yearMonth(item.startedYear, item.startedMonth);
        const end = yearMonth(item.endedYear, item.endedMonth);
        return {
            school: textOrNull(school?.name),
            schoolUrl: textOrNull(school?.url),
            degree: textOrNull(item.degree),
            field: textOrNull(item.fieldOfStudy),
            start,
            end: end || null,
            description: textOrNull(item.description),
        };
    });
}

function certificationsOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => {
        const company = asRecord(item.company);
        return {
            name: textOrNull(item.name),
            authority: textOrNull(item.authority),
            license: textOrNull(item.licenseNumber),
            company: textOrNull(company?.name),
            companyUrl: textOrNull(company?.url),
            start: yearMonth(item.startDateYear, item.startDateMonth),
        };
    });
}

function languagesOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => ({
        name: textOrNull(item.name),
        proficiency: textOrNull(item.proficiency),
    })).filter((item) => item.name);
}

function publicationsOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => ({
        name: textOrNull(item.name),
        publisher: textOrNull(item.publisher),
        description: textOrNull(item.description),
        url: textOrNull(item.url),
    })).filter((item) => item.name || item.url);
}

function patentsOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => ({
        title: textOrNull(item.title),
        number: textOrNull(item.patentNumber),
    })).filter((item) => item.title || item.number);
}

function namedItems(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => {
        const company = asRecord(item.company);
        return {
            name: textOrNull(item.name) || textOrNull(item.title),
            description: textOrNull(item.description),
            url: textOrNull(item.url),
            company: textOrNull(company?.name),
            start: yearMonth(item.startDateYear, item.startedYear),
            end: yearMonth(item.endDateYear, item.endedYear),
        };
    }).filter((item) => item.name || item.description || item.url);
}

function activitiesOf(value: unknown): Record<string, unknown>[] {
    return asRecords(value).map((item) => ({
        title: textOrNull(item.title) || textOrNull(item.name),
        text: textOrNull(item.text) || textOrNull(item.description),
        url: textOrNull(item.url) || textOrNull(item.link),
        date: textOrNull(item.date) || textOrNull(item.createdAt),
    })).filter((item) => item.title || item.text || item.url);
}

function dedupeRoles(roles: Record<string, unknown>[]): Record<string, unknown>[] {
    const seen = new Set<string>();
    return roles.filter((role) => {
        const key = [role.title, role.company, role.start, role.status].map((part) => String(part || '').toLowerCase()).join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function blankRow(inputUrl: string, outcome: Outcome): Record<string, unknown> {
    return {
        inputUrl,
        linkedinUrl: null,
        result: outcome === 'failed' ? 'Failed' : 'No match, free',
        fullName: null,
        firstName: null,
        lastName: null,
        headline: null,
        jobTitle: null,
        company: null,
        companyLinkedInUrl: null,
        location: null,
        country: null,
        industry: null,
        seniority: null,
        jobFunction: null,
        connections: null,
        followers: null,
        about: null,
        skills: null,
        skillsCount: 0,
        languages: [],
        courses: [],
        experienceCount: 0,
        experience: [],
        educationCount: 0,
        education: [],
        certificationsCount: 0,
        certifications: [],
        publications: [],
        patents: [],
        honors: [],
        projects: [],
        volunteer: [],
        organizations: [],
        activities: [],
        checkedAt: new Date().toISOString(),
        charge: 'Free',
        chargeable: false,
    };
}

function rowFromHit(inputUrl: string, body: Record<string, unknown>): Record<string, unknown> {
    const linkedinUrl = normalizeUrl(body.linkedInUrl) || normalizeUrl(body.linkedinUrl);
    const fullName = textOrNull(body.fullName);
    const live = Boolean(linkedinUrl || fullName);
    const defaultGroup = asRecord(body.defaultPosition);
    const experience = live
        ? dedupeRoles([
            ...rolesFrom(defaultGroup ? [defaultGroup] : [], 'Current'),
            ...rolesFrom(body.currentCompanies, 'Current'),
            ...rolesFrom(body.previousCompanies, 'Past'),
        ])
        : [];
    const current = experience.find((role) => role.status === 'Current') || {};
    const skills = live ? stringsOf(body.skills) : [];
    const education = live ? educationOf(body.educations) : [];
    const certifications = live ? certificationsOf(body.certifications) : [];
    const consumed = typeof body.creditConsumed === 'number' ? body.creditConsumed : (live ? 1 : 0);
    const chargeable = live && consumed > 0;
    const industry = stringsOf(body.industry).join('; ');
    return {
        inputUrl,
        linkedinUrl: live ? linkedinUrl : null,
        result: live ? 'Live profile' : 'No match, free',
        fullName: live ? fullName : null,
        firstName: live ? textOrNull(body.firstName) : null,
        lastName: live ? textOrNull(body.lastName) : null,
        headline: live ? textOrNull(body.headline) : null,
        jobTitle: live ? textOrNull(current.title) : null,
        company: live ? textOrNull(current.company) : null,
        companyLinkedInUrl: live ? textOrNull(current.companyUrl) : null,
        location: live ? textOrNull(body.locationName) : null,
        country: live ? textOrNull(body.locationCountry) : null,
        industry: live ? (industry || null) : null,
        seniority: live ? textOrNull(body.seniority) : null,
        jobFunction: live ? textOrNull(body.jobFunction) : null,
        connections: live ? textOrNull(body.connectionsCount) : null,
        followers: live && typeof body.followersCount === 'number' ? body.followersCount : null,
        about: live ? textOrNull(body.summary) : null,
        skills: skills.length ? skills.join('; ') : null,
        skillsCount: skills.length,
        languages: live ? languagesOf(body.languages) : [],
        courses: live ? stringsOf(body.courses) : [],
        experienceCount: experience.length,
        experience,
        educationCount: education.length,
        education,
        certificationsCount: certifications.length,
        certifications,
        publications: live ? publicationsOf(body.publications) : [],
        patents: live ? patentsOf(body.patents) : [],
        honors: live ? namedItems(body.honors) : [],
        projects: live ? namedItems(body.projects) : [],
        volunteer: live ? namedItems(body.volunteerExperiences) : [],
        organizations: live ? stringsOf(body.organizations) : [],
        activities: live ? activitiesOf(body.recentActivities) : [],
        checkedAt: new Date().toISOString(),
        charge: chargeable ? 'Charged' : 'Free',
        chargeable,
    };
}

function publicRow(row: Record<string, unknown>): Record<string, unknown> {
    const { chargeable, ...rest } = row;
    void chargeable;
    return rest;
}

await Actor.init();
if (!API_BASE || !API_KEY) throw new Error('This copy has no API credentials. Run oday/mawsool-live-linkedin-profile on Apify, or request a key from Mawsool.');

const input = (await Actor.getInput<Input>()) || {};
const maxUrls = Math.min(Math.max(Number(input.maxUrls ?? 100), 1), HARD_MAX);
const urls = (await collectUrls(input)).slice(0, maxUrls);
if (!urls.length) throw new Error('No LinkedIn profile URLs found. Add linkedin.com/in/ links, paste a CSV, or upload a file.');

const concurrency = Math.min(Math.max(Number(input.concurrency ?? 20), 1), 50);
const progressId = (input.resumeId || 'auto').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60) || 'auto';
const saveProgress = urls.length > 20 || !!input.resumeId;
const skipFinished = saveProgress && !input.freshStart && (urls.length > 200 || !!input.resumeId);
const resumeStore = saveProgress
    ? await Actor.openKeyValueStore(input.resumeId ? `mawsool-live-profile-resume-${progressId}` : 'mawsool-live-profile-progress-auto')
    : null;

log.info(`Starting ${urls.length} live LinkedIn profile lookup(s), concurrency=${concurrency}.`);
log.info('A profile that is not found is free. This Actor does not return email or phone.');
if (skipFinished) log.info('Profiles already returned are skipped. Set freshStart to fetch them again.');

let batch = urls;
let deferFailures = urls.length > 1;
let nextIndex = 0;
const deferred: string[] = [];
let processed = 0;
let live = 0;
let missed = 0;
let failed = 0;
let skipped = 0;
let stop = false;
let consecutiveOutages = 0;

function noteOutcome(message: string | null): void {
    if (!message) {
        consecutiveOutages = 0;
        return;
    }
    const text = message.toLowerCase();
    const outage = text.includes('did not answer') || text.includes('timed out') || text.includes('fetch failed') || text.includes('network') || text.includes('unavailable') || text.includes('429') || text.includes('502') || text.includes('503') || text.includes('504');
    if (!outage) {
        consecutiveOutages = 0;
        return;
    }
    consecutiveOutages += 1;
    if (consecutiveOutages >= 15 && !stop) {
        stop = true;
        log.error('The lookup service looks unavailable. Stopping so finished rows stay saved and the next run can continue.');
    }
}

async function worker(): Promise<void> {
    while (!stop) {
        const index = nextIndex++;
        if (index >= batch.length) return;
        const url = batch[index];
        const recordKey = createHash('sha256').update(slugOf(url)).digest('hex');
        if (skipFinished && resumeStore && await resumeStore.getValue(`done-${recordKey}`)) {
            skipped += 1;
            continue;
        }
        try {
            const result = await enrichUrl(url);
            if (result.kind === 'stop') {
                stop = true;
                log.error(result.message);
                return;
            }
            const row = result.kind === 'hit' ? rowFromHit(url, result.body) : blankRow(url, 'not_found');
            const chargeable = row.chargeable === true;
            const pushed = chargeable
                ? await Actor.pushData(publicRow(row), EVENT)
                : await Actor.pushData(publicRow(row));
            if (pushed?.eventChargeLimitReached) {
                stop = true;
                return;
            }
            if (row.result === 'Live profile') {
                live += 1;
                if (resumeStore && chargeable) await resumeStore.setValue(`done-${recordKey}`, { at: new Date().toISOString() });
            } else {
                missed += 1;
            }
            noteOutcome(null);
            processed += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unexpected lookup error';
            noteOutcome(message);
            if (deferFailures && !stop) {
                deferred.push(url);
                log.warning(`Profile failed and will be retried at the end: ${message}`);
                continue;
            }
            await Actor.pushData(publicRow(blankRow(url, 'failed')));
            processed += 1;
            failed += 1;
            log.warning(`Failed profile: ${message}`);
        }
    }
}

async function runBatch(): Promise<void> {
    nextIndex = 0;
    const workers = Math.min(concurrency, batch.length);
    if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
}

await runBatch();
if (deferred.length && !stop) {
    log.info(`Retrying ${deferred.length} profile(s) that failed on the first pass.`);
    await sleep(3000);
    batch = deferred.splice(0, deferred.length);
    deferFailures = false;
    await runBatch();
}

await Actor.setValue('OUTPUT', {
    requested: urls.length,
    processed,
    live,
    missed,
    failed,
    skipped,
    stoppedByChargeLimit: stop,
});

log.info(`Finished. Processed=${processed}, live=${live}, missed=${missed}, failed=${failed}, skipped=${skipped}`);
await Actor.exit();
