const crypto = require("crypto");

class PasswordResetToken {
  /**
   * Hash a raw reset token using SHA-256.
   * @param {string} token
   * @returns {string}
   */
  static hashToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  /**
   * Create a new password reset token entity.
   * @param {Object} params
   * @param {string} params.userId - User identifier (e.g. normalized email)
   * @param {string} params.rawToken - The raw token issued to the user
   * @param {string} [params.id] - Optional unique token ID
   * @param {number} [params.expiresInMs=900000] - Token TTL in milliseconds (default: 15 min)
   * @returns {Object}
   */
  static create({ userId, rawToken, id = null, expiresInMs = 24 * 60 * 60 * 1000 }) {
    const tokenId = id || crypto.randomUUID();
    const tokenHash = this.hashToken(rawToken);
    const now = Date.now();

    return {
      id: tokenId,
      userId: String(userId || "").trim().toLowerCase(),
      tokenHash,
      expiresAt: new Date(now + expiresInMs).toISOString(),
      createdAt: new Date(now).toISOString(),
      usedAt: null
    };
  }

  /**
   * Check if a token record is valid (not expired and not used).
   * @param {Object} record
   * @returns {boolean}
   */
  static isValid(record) {
    if (!record) return false;
    if (record.usedAt !== null && record.usedAt !== undefined) return false;
    const expiresTimestamp = new Date(record.expiresAt).getTime();
    if (Number.isNaN(expiresTimestamp) || Date.now() > expiresTimestamp) return false;
    return true;
  }
}

module.exports = PasswordResetToken;
