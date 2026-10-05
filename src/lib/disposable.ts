/**
 * Friendly client-side pre-check for throwaway email domains.
 * The real enforcement is the blocked_email_domains table + trigger in the database
 * (supabase/migrations). Keep this list in sync with that table's seed data.
 */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.net",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "trashmail.com",
  "trashmail.net",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "emailondeck.com",
  "spamgourmet.com",
  "spam4.me",
  "tempinbox.com",
  "burnermail.io",
  "discard.email",
  "discardmail.com",
  "moakt.com",
  "tmail.ws",
  "tmpmail.org",
  "tmpmail.net",
  "mailcatch.com",
  "mytemp.email",
  "inboxkitten.com",
  "emailfake.com",
  "fakemail.net",
  "mail.tm",
  "harakirimail.com",
  "jetable.org",
  "mailforspam.com",
  "tempr.email",
  "minuteinbox.com",
  "anonbox.net",
  "owlymail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1];
  return Boolean(domain) && DISPOSABLE_DOMAINS.has(domain);
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
