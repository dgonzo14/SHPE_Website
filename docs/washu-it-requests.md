# WashU IT requests — washushpe.org

Two separate asks against two different systems. They may be handled by the
same team or routed separately, so each is written to stand alone.

**Send through the official WashU IT service desk / ticket portal.** Do not
guess at an address — file it the way the university expects, and paste the
relevant email below into the ticket body.

A note on framing: request 1 is a confirmed, reproducible block with a clear
cause. Request 2 is an inferred cause — the symptom is certain, the mechanism
is our best explanation. The draft says so. Overstating it to a mail admin who
can check the logs is the fastest way to lose credibility on request 1.

---

## Request 1 — Cisco Umbrella: domain categorised as "Newly Seen"

**Subject:** Umbrella block on washushpe.org — registered student organization domain

> Hello,
>
> I'm writing on behalf of the Society of Hispanic Professional Engineers
> (SHPE) chapter at WashU, a registered student organization. Our WUGO listing
> is here:
> https://wustl.presence.io/organization/society-of-hispanic-professional-engineers
>
> We recently launched a chapter website and member portal at **washushpe.org**,
> a domain we registered and control. Links from our account-confirmation emails
> are currently blocked on the campus network by Cisco Umbrella.
>
> **What students see**
>
> The Umbrella block page names the category as **"Newly Seen Domains"** — the
> domain was registered on 7 September 2026, so this appears to be an
> age-based classification rather than any observed malicious activity.
>
> Because the block is enforced by TLS interception, students on personal
> laptops do not see the block page at all. They see a browser security warning
> (`NET::ERR_CERT_AUTHORITY_INVALID`) telling them attackers may be trying to
> steal their information. That is a worse outcome than a clean block: it
> teaches students that our official chapter site is dangerous.
>
> **What we are asking**
>
> Could you allow `washushpe.org` and its subdomains in Umbrella? The specific
> hostname appearing in the block is:
>
> - `r.mail.washushpe.org` — link redirect for our transactional email
>
> Other hostnames on the domain, for completeness:
>
> - `washushpe.org` and `www.washushpe.org` — the public site (Netlify)
> - `mail.washushpe.org`, `img.mail.washushpe.org` — email infrastructure
>
> **Supporting detail**
>
> - The domain is authenticated for email with SPF, DKIM and DMARC. DKIM is
>   published at `brevo1._domainkey` and `brevo2._domainkey`; DMARC is
>   `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`.
> - Mail is sent through Brevo, an established ESP; the redirect hostname is a
>   CNAME to `mail-washushpe-org.r.brand.brevosend.com`.
> - The site is served over HTTPS with a Let's Encrypt certificate and a
>   restrictive Content-Security-Policy.
> - No user-generated content is hosted on the domain.
>
> **Impact**
>
> Our first general body meeting is on [DATE]. Students who register cannot
> complete signup, because confirming an account requires following a link that
> the campus network blocks. This affects every student attempting to join from
> campus wifi.
>
> Happy to provide anything else useful — DNS records, the Netlify
> configuration, or a test message.
>
> Thank you,
> [NAME]
> [ROLE], SHPE WashU
> [WUSTL EMAIL] · washushpe.org

---

## Request 2 — Microsoft 365: confirmation emails removed after delivery

**Subject:** Messages from noreply@washushpe.org removed from wustl.edu mailboxes after delivery

> Hello,
>
> I'm writing on behalf of the SHPE chapter at WashU, a registered student
> organization (WUGO listing:
> https://wustl.presence.io/organization/society-of-hispanic-professional-engineers).
>
> We are seeing account-confirmation emails sent to `@wustl.edu` addresses
> **arrive and then disappear from the mailbox**. They are not in Junk, not in
> Deleted Items, and not in any other folder — they are visible briefly and then
> gone.
>
> Our sending logs show these messages as **delivered**, so the removal is
> happening after delivery. Our best guess is Zero-hour Auto Purge in Defender
> for Office 365 reclassifying them, but we cannot see your side and would
> rather you check than take our word for it.
>
> **Sender details**
>
> - From: `noreply@washushpe.org`
> - Sending domain: `washushpe.org`, registered 7 September 2026
> - ESP: Brevo (`smtp-relay.brevo.com`)
> - Authentication: SPF, DKIM and DMARC all published and passing. DKIM at
>   `brevo1._domainkey.washushpe.org` and `brevo2._domainkey.washushpe.org`;
>   DMARC `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`.
> - Message content: a short plain confirmation email with a single link back to
>   our own service. No attachments, no marketing content, no tracking pixels
>   beyond the ESP default.
>
> We recognise how this looks from a filtering perspective — a domain a few days
> old, sending "confirm your account" messages with a link, through a relay. We
> would make the same call in your position. That is exactly why we are asking
> rather than trying to work around it.
>
> **What we are asking**
>
> Could you add `washushpe.org` to the tenant allow list for inbound mail, so
> confirmation messages to `@wustl.edu` students are not removed post-delivery?
> If a message trace would help, we can supply exact timestamps and recipient
> addresses for affected messages.
>
> **Impact**
>
> Students cannot finish creating an account, so they cannot check in to events
> or track membership. Our first general body meeting is [DATE].
>
> We are also changing our emails to remove links entirely and send a short
> numeric code instead, which should reduce the filtering signal considerably.
> This request is to make the underlying domain trusted rather than to work
> around the filter.
>
> Thank you,
> [NAME]
> [ROLE], SHPE WashU
> [WUSTL EMAIL] · washushpe.org

---

## Before sending

Fill in: `[NAME]`, `[ROLE]`, `[WUSTL EMAIL]`, and `[DATE]` for the GBM.

Send **request 1 first** and on its own if you can only push one. It is the
sharper ask: a confirmed block, a named category, an obvious cause, and a
one-line remedy. Request 2 depends on someone running a message trace, which
takes longer and may bounce between teams.

If IT asks for evidence, the useful artefacts are:

- The Umbrella block page screenshot showing "Newly Seen Domains"
- The browser certificate warning for `r.mail.washushpe.org`
- Brevo's transactional log entry showing the message as delivered

Do not tell them the block is a false positive on a *security* basis. It is
not — Umbrella classified a three-day-old domain as new, which is accurate. The
request is for an exception on the grounds that we own the domain and it serves
a registered student organization, not that their system got it wrong.
