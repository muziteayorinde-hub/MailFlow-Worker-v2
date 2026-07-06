import Imap from "imap";
import { simpleParser } from "mailparser";

export async function fetchEmails(payload) {
  return new Promise((resolve, reject) => {
    const account = payload.account || payload;
    if (!account) return reject(new Error("No account data received"));

    const username = account.username || account.email || account.imap_username;
    const password = account.password || account.imap_password;
    const host = account.imapHost || account.imap_host || account.host || "business24.web-hosting.com";
    const port = Number(account.imapPort || account.imap_port || account.port) || 993;
    const folder = payload.folder || "INBOX";
    const limit = Number(payload.limit || 50);
    const allowInvalidCerts = account.allow_invalid_certs !== false;

    if (!username || !password) return reject(new Error("Missing IMAP username or password"));

    console.log("FINAL IMAP CONFIG", { username, host, port, folder, limit, hasPassword: !!password });

    const imap = new Imap({
      user: username,
      password,
      host,
      port,
      tls: true,
      tlsOptions: { rejectUnauthorized: !allowInvalidCerts },
      connTimeout: 30000,
      authTimeout: 30000,
      keepalive: true,
    });

    const emails = [];

    imap.once("ready", () => {
      console.log("IMAP CONNECTED");
      imap.openBox(folder, true, (err, box) => {
        if (err) { imap.end(); return reject(err); }
        const total = box.messages.total;
        if (!total) { imap.end(); return resolve({ emails: [] }); }
        const start = Math.max(1, total - limit + 1);
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: "", struct: true });

        fetch.on("message", (msg) => {
          let attrs = {};
          msg.once("attributes", (a) => { attrs = a || {}; });
          msg.on("body", async (stream) => {
            try {
              const parsed = await simpleParser(stream);
              emails.push({
                uid: attrs.uid,
                flags: attrs.flags || [],
                message_id: parsed.messageId || null,
                subject: parsed.subject || "",
                from: parsed.from?.text || "",
                from_address: parsed.from?.value?.[0]?.address || "",
                from_name: parsed.from?.value?.[0]?.name || "",
                to: parsed.to?.text || "",
                to_addresses: parsed.to?.value || [],
                cc_addresses: parsed.cc?.value || [],
                text: parsed.text || "",
                html: parsed.html || "",
                body_text: parsed.text || "",
                body_html: parsed.html || "",
                preview: (parsed.text || "").slice(0, 200),
                date: parsed.date || new Date(),
                sent_at: parsed.date || new Date(),
                is_read: (attrs.flags || []).includes("\\Seen"),
                has_attachments: (parsed.attachments?.length || 0) > 0,
                attachments: (parsed.attachments || []).map((a) => ({ filename: a.filename, content_type: a.contentType, size: a.size, checksum: a.checksum })),
              });
            } catch (err) { console.error("PARSE ERROR", err.message); }
          });
        });

        fetch.once("error", (err) => { imap.end(); reject(err); });
        fetch.once("end", () => { console.log("FETCH COMPLETE", { count: emails.length }); imap.end(); resolve({ emails: emails.reverse() }); });
      });
    });

    imap.once("error", (err) => { console.error("IMAP ERROR", err.message); reject(err); });
    imap.once("end", () => { console.log("IMAP CONNECTION CLOSED"); });
    imap.connect();
  });
}
