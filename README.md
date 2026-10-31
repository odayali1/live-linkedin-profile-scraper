# Live LinkedIn Profile Scraper

**Scrape a live full LinkedIn profile. A miss is free.** Paste a `linkedin.com/in/...` URL. When the person is found, you get the profile fetched at that moment: headline, company, experience with dates and descriptions, education, skills, certifications, courses, languages, publications, and patents. When nothing is found, you are not charged.

[$0.90 per 1,000 live profiles](https://apify.com/oday/mawsool-live-linkedin-profile) on every Apify plan, including the free plan. No cookies. This does not return email or phone.

Mawsool is not affiliated with LinkedIn.

## Run it

| What you want | Where |
| --- | --- |
| Run it now, no API key to manage | [Live LinkedIn Profile Scraper on Apify](https://apify.com/oday/mawsool-live-linkedin-profile) |
| An API key for Mawsool | [mawsool.tech](https://mawsool.tech/) · [Docs](https://docs.mawsool.tech/) · [Pricing](https://mawsool.tech/pricing) |
| A question about a list or a key | [osama@mawsool.tech](mailto:osama@mawsool.tech) · [info@mawsool.tech](mailto:info@mawsool.tech) |

The hosted Actor already includes access. You do not put a key in this repository. If you want a key for your own integration, request it from Mawsool.

## No match, no charge

`result` is `No match, free` when no profile is found. `charge` is `Free`. You pay only when a live profile comes back.

A file of 10,000 URLs that returns 8,000 profiles costs 8,000 profiles. The 2,000 missing URLs cost nothing. Those 8,000 profiles are $7.20.

## What a live profile includes

The row is fetched when you run. `checkedAt` is that time.

- Name, headline, about, location, and country
- Current title, company, and company URL
- Seniority, job function, and industry
- Connections and followers
- Every current role and previous company, with dates, employment type, and the description
- Education, with school, degree, field, and years
- Skills and courses
- Certifications, languages, publications, patents, honors, projects, volunteer work, and organizations

A live profile from this endpoint can carry several current roles, past companies, job descriptions, and the credential sections above. It does not include an email address or a phone number.

## Price

$0.90 per 1,000 live profiles on every Apify plan, including the free plan. There is no separate monthly fee.

## Bulk

One URL or a file of up to 1,000,000. Requests run concurrently. A stopped file can resume, and profiles already returned are not charged again.

## Use something else when

- The URL no longer opens: [Fix Broken LinkedIn URLs](https://apify.com/oday/mawsool-fix-broken-linkedin-urls). A miss there is free.
- You only need the current company and headline: [Profile Freshness Check](https://apify.com/oday/mawsool-linkedin-profile-freshness), from $0.40 per 1,000.
- You want the personal email: [LinkedIn Email Finder](https://apify.com/oday/mawsool-linkedin-personal-email-finder). Exact match only. A miss is free.

## Pages

- [A miss is free](docs/no-match-no-charge.md)
- [What the live profile contains](docs/live-full-profile.md)
