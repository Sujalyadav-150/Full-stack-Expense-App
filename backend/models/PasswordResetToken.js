const mongoose = require("mongoose");
const crypto = require("crypto");

const tokenSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  tokenHash: {
    type: String,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  usedAt: {
    type: Date,
    default: null
  }
});

tokenSchema.index({ tokenHash: 1 });
tokenSchema.index({ userId: 1 });

const MongooseToken = mongoose.models.PasswordResetToken || mongoose.model("PasswordResetToken", tokenSchema);

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
   * Create a new password reset token record.
   * @param {Object} params
   * @param {string} params.userId - User identifier (normalized email)
   * @param {string} params.rawToken - The raw token issued to the user
   * @param {string} [params.id] - Optional unique token ID
   * @param {number} [params.expiresInMs=900000] - Token TTL in milliseconds (default: 15 min)
   * @returns {Object}
   */
  static create({ userId, rawToken, id = null, expiresInMs = 15 * 60 * 1000 }) {
    const tokenId = id || crypto.randomUUID();
    const tokenHash = this.hashToken(rawToken);
    const now = Date.now();

    return {
      id: tokenId,
      userId: String(userId || "").trim().toLowerCase(),
      tokenHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiresInMs).toISOString(),
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

PasswordResetToken.MongooseModel = MongooseToken;

module.exports = PasswordResetToken;
