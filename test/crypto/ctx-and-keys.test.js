const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ctx, deriveHandKey } = require("../helpers/hashes");

describe("CTX and Hand Key Derivation", function () {
    describe("ctx function", function () {
        it("should create a context hash from chainId, contract, channelId, handId", function () {
            const chainId = 1n;
            const contract = "0x1234567890123456789012345678901234567890";
            const channelId = 42n;
            const handId = 100n;
            
            const result = ctx(chainId, contract, channelId, handId);
            
            // Should return a 32-byte hash
            expect(result).to.be.a("string");
            expect(result).to.match(/^0x[a-fA-F0-9]{64}$/);
            
            // Should be deterministic
            const result2 = ctx(chainId, contract, channelId, handId);
            expect(result).to.equal(result2);
        });
        
        it("should produce different hashes for different parameters", function () {
            const chainId = 1n;
            const contract = "0x1234567890123456789012345678901234567890";
            const channelId = 42n;
            const handId = 100n;
            
            const result1 = ctx(chainId, contract, channelId, handId);
            const result2 = ctx(chainId, contract, channelId, handId + 1n);
            const result3 = ctx(chainId, contract, channelId + 1n, handId);
            
            expect(result1).to.not.equal(result2);
            expect(result1).to.not.equal(result3);
            expect(result2).to.not.equal(result3);
        });
        
        it("should handle different contract addresses", function () {
            const chainId = 1n;
            const contract1 = "0x1234567890123456789012345678901234567890";
            const contract2 = "0x0987654321098765432109876543210987654321";
            const channelId = 42n;
            const handId = 100n;
            
            const result1 = ctx(chainId, contract1, channelId, handId);
            const result2 = ctx(chainId, contract2, channelId, handId);
            
            expect(result1).to.not.equal(result2);
        });
    });
    
    describe("deriveHandKey function", function () {
        it("should derive hand keys for players A and B", function () {
            const master = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue = ethers.hexlify(ethers.randomBytes(32));
            
            const keyA = deriveHandKey(master, ctxValue, "A");
            const keyB = deriveHandKey(master, ctxValue, "B");
            
            // Should return 32-byte Uint8Arrays
            expect(keyA).to.be.instanceOf(Uint8Array);
            expect(keyA.length).to.equal(32);
            expect(keyB).to.be.instanceOf(Uint8Array);
            expect(keyB.length).to.equal(32);
            
            // Keys for A and B should be different
            expect(keyA).to.not.deep.equal(keyB);
        });
        
        it("should be deterministic", function () {
            const master = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue = ethers.hexlify(ethers.randomBytes(32));
            
            const keyA1 = deriveHandKey(master, ctxValue, "A");
            const keyA2 = deriveHandKey(master, ctxValue, "A");
            
            expect(keyA1).to.deep.equal(keyA2);
        });
        
        it("should produce different keys for different masters", function () {
            const master1 = ethers.hexlify(ethers.randomBytes(32));
            const master2 = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue = ethers.hexlify(ethers.randomBytes(32));
            
            const key1 = deriveHandKey(master1, ctxValue, "A");
            const key2 = deriveHandKey(master2, ctxValue, "A");
            
            expect(key1).to.not.deep.equal(key2);
        });
        
        it("should produce different keys for different contexts", function () {
            const master = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue1 = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue2 = ethers.hexlify(ethers.randomBytes(32));
            
            const key1 = deriveHandKey(master, ctxValue1, "A");
            const key2 = deriveHandKey(master, ctxValue2, "A");
            
            expect(key1).to.not.deep.equal(key2);
        });
        
        it("should only accept 'A' or 'B' for who parameter", function () {
            const master = ethers.hexlify(ethers.randomBytes(32));
            const ctxValue = ethers.hexlify(ethers.randomBytes(32));
            
            expect(() => deriveHandKey(master, ctxValue, "C")).to.throw('who parameter must be "A" or "B"');
            expect(() => deriveHandKey(master, ctxValue, "")).to.throw('who parameter must be "A" or "B"');
            expect(() => deriveHandKey(master, ctxValue, "a")).to.throw('who parameter must be "A" or "B"');
        });
    });
    
    describe("integration tests", function () {
        it("should work together - ctx as salt for deriveHandKey", function () {
            const chainId = 1n;
            const contract = "0x1234567890123456789012345678901234567890";
            const channelId = 42n;
            const handId = 100n;
            const master = ethers.hexlify(ethers.randomBytes(32));
            
            // Create context
            const ctxValue = ctx(chainId, contract, channelId, handId);
            
            // Derive keys using the context as salt
            const keyA = deriveHandKey(master, ctxValue, "A");
            const keyB = deriveHandKey(master, ctxValue, "B");
            
            expect(keyA).to.be.instanceOf(Uint8Array);
            expect(keyB).to.be.instanceOf(Uint8Array);
            expect(keyA.length).to.equal(32);
            expect(keyB.length).to.equal(32);
            expect(keyA).to.not.deep.equal(keyB);
        });
    });
});