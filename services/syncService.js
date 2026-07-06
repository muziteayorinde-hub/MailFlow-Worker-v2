import { supabase } from "./database.js";
import { decryptPassword } from "./cryptoService.js";
import { fetchEmails } from "./emailService.js";

let running = false;

export async function syncAllActiveAccounts() {
  if (running) {
    console.log("AUTO SYNC SKIPPED (already running)");
    return { skipped: true, reason: "already running" };
  }

  running = true;
  const startedAt = Date.now();
  console.log("AUTO SYNC STARTED");

  try {
    const { data: accounts, error } = await supabase.from("email_accounts").select("*").eq("is_active", true);
    if (error) throw error;
    console.log(`Loaded ${accounts?.length || 0} active accounts`);

    if (!accounts?.length) {
      console.log("No active email accounts found.");
      return { accountsLoaded: 0, fetched: 0, saved: 0 };
    }

    let totalFetched = 0;
    let totalSaved = 0;
    const mailboxErrors = [];

    for (const account of accounts) {
      try {
        const result = await syncAccountRecord(account, { folder: "INBOX", limit: 50 });
        totalFetched += result.fetched || 0;
        totalSaved += result.saved || 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Sync failed for ${account.email}:`, message);
        mailboxErrors.push({ email: account.email, error: message });
        await supabase.from("email_accounts").update({ last_error: message }).eq("id", account.id);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log("Sync complete", { accountsLoaded: accounts.length, newEmailsFetched: totalFetched, emailsSaved: totalSaved, mailboxErrors, averageSyncDurationMs: durationMs / Math.max(accounts.length, 1), workerUptimeSeconds: process.uptime() });
    return { accountsLoaded: accounts.length, fetched: totalFetched, saved: totalSaved, mailboxErrors, durationMs };
  } catch (err) {
    console.error("AUTO SYNC ERROR:", err.message);
    return { success: false, error: err.message };
  } finally {
    running = false;
  }
}

export async function syncOneAccount(accountId, options = {}) {
  const { data: account, error } = await supabase.from("email_accounts").select("*").eq("id", accountId).single();
  if (error || !account) throw new Error(error?.message || "Account not found");
  return syncAccountRecord(account, options);
}

async function syncAccountRecord(account, options = {}) {
  console.log(`Syncing ${account.email}`);
  const password = decryptPassword(account.encrypted_password);

  const accountPayload = {
    ...account,
    username: account.username || account.email,
    password,
    imap_host: account.imap_host,
    imap_port: account.imap_port || 993,
    allow_invalid_certs: account.allow_invalid_certs !== false,
  };

  const result = await fetchEmails({ account: accountPayload, folder: options.folder || "INBOX", limit: options.limit || 50 });
  const emails = result?.emails || [];
  console.log(`Fetched ${emails.length} emails for ${account.email}`);

  let saved = 0;
  for (const email of emails) {
    const inserted = await saveEmail(account, email);
    if (inserted) saved += 1;
  }

  await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("id", account.id);
  console.log(`Saved ${saved} new emails for ${account.email}`);
  console.log("Updated last_sync_at");
  return { account_id: account.id, email: account.email, fetched: emails.length, saved };
}

async function saveEmail(account, email) {
  const messageId = email.message_id || email.messageId || `${account.id}-${email.uid || ""}-${email.date || ""}-${email.subject || ""}`;

  const { data: existing } = await supabase.from("emails").select("id").eq("account_id", account.id).eq("message_id", messageId).maybeSingle();
  if (existing) return false;

  const row = {
    account_id: account.id,
    uid: email.uid || null,
    message_id: messageId,
    from_address: email.from_address || email.from || "",
    from_name: email.from_name || "",
    to_addresses: email.to_addresses || [],
    cc_addresses: email.cc_addresses || [],
    subject: email.subject || "",
    body_text: email.body_text || email.text || "",
    body_html: email.body_html || email.html || "",
    preview: email.preview || (email.text || "").slice(0, 200),
    folder: "inbox",
    is_read: email.is_read === true,
    has_attachments: email.has_attachments === true,
    sent_at: email.sent_at || email.date || new Date().toISOString(),
    flags: email.flags || [],
  };

  const { error } = await supabase.from("emails").insert(row);
  if (error) {
    if (error.code === "23505" || String(error.message || "").toLowerCase().includes("duplicate")) return false;
    throw error;
  }
  return true;
}
