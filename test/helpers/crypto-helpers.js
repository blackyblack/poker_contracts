const crypto = require('crypto');

/**
 * Compute HMAC-SHA256 of data using the provided key
 * @param {Uint8Array} key - The secret key
 * @param {Uint8Array} data - The data to authenticate
 * @returns {Promise<Uint8Array>} Promise resolving to the HMAC digest as Uint8Array
 */
async function hmacSha256(key, data) {
    if (!(key instanceof Uint8Array)) {
        throw new Error('Key must be a Uint8Array');
    }
    if (!(data instanceof Uint8Array)) {
        throw new Error('Data must be a Uint8Array');
    }
    
    const hmac = crypto.createHmac('sha256', Buffer.from(key));
    hmac.update(Buffer.from(data));
    const digest = hmac.digest();
    
    // Convert Buffer to Uint8Array
    return new Uint8Array(digest);
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex string (with or without 0x prefix)
 * @returns {Uint8Array} The bytes as Uint8Array
 */
function hexToBytes(hex) {
    if (typeof hex !== 'string') {
        throw new Error('Input must be a hex string');
    }
    
    // Remove 0x prefix if present
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    
    // Ensure even length
    if (cleanHex.length % 2 !== 0) {
        throw new Error('Hex string must have even length');
    }
    
    // Validate hex characters
    if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
        throw new Error('Invalid hex string');
    }
    
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
    }
    
    return bytes;
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes - The bytes to convert
 * @param {boolean} addPrefix - Whether to add 0x prefix (default: false)
 * @returns {string} Hex string representation
 */
function bytesToHex(bytes, addPrefix = false) {
    if (!(bytes instanceof Uint8Array)) {
        throw new Error('Input must be a Uint8Array');
    }
    
    const hex = Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    
    return addPrefix ? '0x' + hex : hex;
}

/**
 * Generate a random nonce of specified length
 * @param {number} length - Length in bytes (default: 12 as specified in requirements)
 * @returns {Uint8Array} Random nonce as Uint8Array
 */
function generateNonce(length = 12) {
    if (typeof length !== 'number' || length <= 0) {
        throw new Error('Length must be a positive number');
    }
    
    const nonce = new Uint8Array(length);
    crypto.getRandomValues(nonce);
    return nonce;
}

module.exports = {
    hmacSha256,
    hexToBytes,
    bytesToHex,
    generateNonce
};