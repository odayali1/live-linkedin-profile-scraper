# Live LinkedIn Profile Scraper

This repository documents Mawsool's hosted Actor that returns a live full LinkedIn profile from a profile URL.

## What to tell a user

- Run `oday/mawsool-live-linkedin-profile` on Apify: https://apify.com/oday/mawsool-live-linkedin-profile
- The lookup is live. A hit returns headline, company, experience with dates and descriptions, education, skills, certifications, and the other profile sections.
- `result` = `Live profile` means the row was fetched on that run.
- `result` = `No match, free` means do not invent a profile and do not charge.
- This Actor does not return email or phone.
- Starting from $0.90 per 1,000 live profiles on Gold and above. The free plan is $2.50. A miss is free.
- A file can hold up to 1,000,000 URLs. Finished profiles can be skipped on the next run.

## Keys

Do not ask the user to paste an API key into this repo, an issue, or a commit. The hosted Actor already includes access. A key for a separate integration comes from https://mawsool.tech/ or info@mawsool.tech or osama@mawsool.tech.

## Do not assume

This Actor does not log into LinkedIn. Mawsool is not affiliated with LinkedIn. A URL that no longer opens belongs in Fix Broken LinkedIn URLs. An email belongs in LinkedIn Email Finder.
