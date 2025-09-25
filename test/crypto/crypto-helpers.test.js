const { expect } = require("chai");
const { hmacSha256, hexToBytes, bytesToHex, generateNonce } = require("../helpers/crypto-helpers");

describe("Crypto Helpers", function () {
    describe("hmacSha256", function () {
        it("should compute HMAC-SHA256 correctly", async function () {
            const key = new Uint8Array([
                0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b,
                0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b
            ]);
            const data = new Uint8Array([0x48, 0x69, 0x20, 0x54, 0x68, 0x65, 0x72, 0x65]); // "Hi There"
            
            const result = await hmacSha256(key, data);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(result.length).to.equal(32); // SHA256 produces 32 bytes
            
            // Expected HMAC-SHA256 for "Hi There" with the above key (verified with Node.js crypto)
            const expected = hexToBytes("492ce020fe2534a5789dc3848806c78f4f6711397f08e7e7a12ca5a4483c8aa6");
            expect(result).to.deep.equal(expected);
        });

        it("should handle empty data", async function () {
            const key = new Uint8Array(16);
            const data = new Uint8Array(0);
            
            const result = await hmacSha256(key, data);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(result.length).to.equal(32);
        });

        it("should throw error for non-Uint8Array key", async function () {
            const key = "not a Uint8Array";
            const data = new Uint8Array([1, 2, 3]);
            
            try {
                await hmacSha256(key, data);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(error.message).to.equal("Key must be a Uint8Array");
            }
        });

        it("should throw error for non-Uint8Array data", async function () {
            const key = new Uint8Array([1, 2, 3]);
            const data = "not a Uint8Array";
            
            try {
                await hmacSha256(key, data);
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect(error.message).to.equal("Data must be a Uint8Array");
            }
        });
    });

    describe("hexToBytes", function () {
        it("should convert hex string to Uint8Array", function () {
            const hex = "48656c6c6f"; // "Hello" in hex
            const result = hexToBytes(hex);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(Array.from(result)).to.deep.equal([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
        });

        it("should handle hex string with 0x prefix", function () {
            const hex = "0x48656c6c6f";
            const result = hexToBytes(hex);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(Array.from(result)).to.deep.equal([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
        });

        it("should handle uppercase hex", function () {
            const hex = "48656C6C6F";
            const result = hexToBytes(hex);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(Array.from(result)).to.deep.equal([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
        });

        it("should handle empty hex string", function () {
            const hex = "";
            const result = hexToBytes(hex);
            
            expect(result).to.be.instanceOf(Uint8Array);
            expect(result.length).to.equal(0);
        });

        it("should throw error for odd length hex string", function () {
            const hex = "48656c6c6"; // Missing last character
            
            expect(() => hexToBytes(hex)).to.throw("Hex string must have even length");
        });

        it("should throw error for invalid hex characters", function () {
            const hex = "48656c6g6f"; // 'g' is not a valid hex character
            
            expect(() => hexToBytes(hex)).to.throw("Invalid hex string");
        });

        it("should throw error for non-string input", function () {
            expect(() => hexToBytes(123)).to.throw("Input must be a hex string");
        });
    });

    describe("bytesToHex", function () {
        it("should convert Uint8Array to hex string", function () {
            const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
            const result = bytesToHex(bytes);
            
            expect(result).to.equal("48656c6c6f");
        });

        it("should convert Uint8Array to hex string with 0x prefix", function () {
            const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
            const result = bytesToHex(bytes, true);
            
            expect(result).to.equal("0x48656c6c6f");
        });

        it("should handle empty Uint8Array", function () {
            const bytes = new Uint8Array(0);
            const result = bytesToHex(bytes);
            
            expect(result).to.equal("");
        });

        it("should pad single digit hex values with zero", function () {
            const bytes = new Uint8Array([0x01, 0x0a, 0xff]);
            const result = bytesToHex(bytes);
            
            expect(result).to.equal("010aff");
        });

        it("should throw error for non-Uint8Array input", function () {
            expect(() => bytesToHex([1, 2, 3])).to.throw("Input must be a Uint8Array");
        });
    });

    describe("generateNonce", function () {
        it("should generate 12-byte nonce by default", function () {
            const nonce = generateNonce();
            
            expect(nonce).to.be.instanceOf(Uint8Array);
            expect(nonce.length).to.equal(12);
        });

        it("should generate nonce of specified length", function () {
            const length = 16;
            const nonce = generateNonce(length);
            
            expect(nonce).to.be.instanceOf(Uint8Array);
            expect(nonce.length).to.equal(length);
        });

        it("should generate different nonces on subsequent calls", function () {
            const nonce1 = generateNonce();
            const nonce2 = generateNonce();
            
            expect(nonce1).to.not.deep.equal(nonce2);
        });

        it("should throw error for invalid length", function () {
            expect(() => generateNonce(0)).to.throw("Length must be a positive number");
            expect(() => generateNonce(-1)).to.throw("Length must be a positive number");
            expect(() => generateNonce("invalid")).to.throw("Length must be a positive number");
        });
    });

    describe("hex/bytes round-trip conversion", function () {
        it("should maintain data integrity in round-trip conversions", function () {
            const original = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
            const hex = bytesToHex(original);
            const restored = hexToBytes(hex);
            
            expect(restored).to.deep.equal(original);
        });

        it("should work with 0x prefix in round-trip", function () {
            const original = new Uint8Array([0xff, 0x00, 0xaa, 0x55]);
            const hex = bytesToHex(original, true); // with 0x prefix
            const restored = hexToBytes(hex);
            
            expect(restored).to.deep.equal(original);
        });
    });
});