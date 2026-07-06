import crypto from "crypto";

function getKey() {
  const raw = process.env.MAIL_ENCRYPTION_KEY || "";
  return crypto.createHash("sha256").update(raw).digest();
}

export function decryptPassword(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();

  if (!trimmed.includes(":") && !trimmed.startsWith("{")) return trimmed;

  try {
    let ivHex;
    let encryptedHex;

    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      ivHex = parsed.iv;
      encryptedHex = parsed.encryptedData || parsed.encrypted;
    } else {
      const parts = trimmed.split(":");
      ivHex = parts[0];
      encryptedHex = parts[1];
    }

    if (!ivHex || !encryptedHex) return trimmed;

    const decipher = crypto.createDecipheriv("aes-256-cbc", getKey(), Buffer.from(ivHex, "hex"));
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.warn("Password decrypt fallback used:", err.message);
    return trimmed;
  }
}
