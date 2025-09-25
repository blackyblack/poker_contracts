const { expect } = require("chai");
const { deriveA } = require("../helpers/hashes");

describe("deriveA function", function () {
    const handKeyA = "0x" + "a1".repeat(32); // 32-byte test key

    it("derives correct parameters for a single card", function () {
        const cardId = 0;
        const result = deriveA(handKeyA, cardId);
        
        // Verify all required fields are present
        expect(result).to.have.property('uid');
        expect(result).to.have.property('label'); 
        expect(result).to.have.property('kA');
        expect(result).to.have.property('nonceA');
        
        // Verify correct lengths
        expect(result.uid).to.match(/^0x[0-9a-f]{64}$/); // 32 bytes
        expect(result.label).to.match(/^0x[0-9a-f]{64}$/); // 32 bytes
        expect(result.kA).to.match(/^0x[0-9a-f]{64}$/); // 32 bytes
        expect(result.nonceA).to.match(/^0x[0-9a-f]{24}$/); // 12 bytes
    });

    it("produces distinct labels for all 52 cards", function () {
        const labels = new Set();
        
        for (let cardId = 0; cardId < 52; cardId++) {
            const result = deriveA(handKeyA, cardId);
            labels.add(result.label);
        }
        
        // All 52 cards should produce distinct labels
        expect(labels.size).to.equal(52);
    });

    it("produces stable results across runs", function () {
        const cardId = 25; // Test with middle card
        
        // Run derivation multiple times
        const results = [];
        for (let i = 0; i < 5; i++) {
            results.push(deriveA(handKeyA, cardId));
        }
        
        // All results should be identical
        for (let i = 1; i < results.length; i++) {
            expect(results[i].uid).to.equal(results[0].uid);
            expect(results[i].label).to.equal(results[0].label);
            expect(results[i].kA).to.equal(results[0].kA);
            expect(results[i].nonceA).to.equal(results[0].nonceA);
        }
    });

    it("produces different results for different cardIds", function () {
        const result0 = deriveA(handKeyA, 0);
        const result1 = deriveA(handKeyA, 1);
        const result51 = deriveA(handKeyA, 51);
        
        // All fields should be different for different cards
        expect(result0.uid).to.not.equal(result1.uid);
        expect(result0.label).to.not.equal(result1.label);
        expect(result0.kA).to.not.equal(result1.kA);
        expect(result0.nonceA).to.not.equal(result1.nonceA);
        
        expect(result1.uid).to.not.equal(result51.uid);
        expect(result1.label).to.not.equal(result51.label);
        expect(result1.kA).to.not.equal(result51.kA);
        expect(result1.nonceA).to.not.equal(result51.nonceA);
    });

    it("produces different results for different handKeys", function () {
        const handKeyB = "0x" + "b2".repeat(32);
        const cardId = 10;
        
        const resultA = deriveA(handKeyA, cardId);
        const resultB = deriveA(handKeyB, cardId);
        
        // All fields should be different for different hand keys
        expect(resultA.uid).to.not.equal(resultB.uid);
        expect(resultA.label).to.not.equal(resultB.label);
        expect(resultA.kA).to.not.equal(resultB.kA);
        expect(resultA.nonceA).to.not.equal(resultB.nonceA);
    });

    it("handles edge case cardIds correctly", function () {
        // Test edge cases
        const results = [
            deriveA(handKeyA, 0),    // First card
            deriveA(handKeyA, 51),   // Last card
        ];
        
        results.forEach(result => {
            expect(result.uid).to.match(/^0x[0-9a-f]{64}$/);
            expect(result.label).to.match(/^0x[0-9a-f]{64}$/);
            expect(result.kA).to.match(/^0x[0-9a-f]{64}$/);
            expect(result.nonceA).to.match(/^0x[0-9a-f]{24}$/);
        });
    });

    it("comprehensive test: 52 cards produce 52 distinct labels, stable across runs", function () {
        const runs = 3;
        const allRunsLabels = [];
        
        // Perform multiple runs
        for (let run = 0; run < runs; run++) {
            const labels = new Set();
            
            for (let cardId = 0; cardId < 52; cardId++) {
                const result = deriveA(handKeyA, cardId);
                labels.add(result.label);
            }
            
            // Each run should produce 52 distinct labels
            expect(labels.size).to.equal(52);
            allRunsLabels.push(Array.from(labels).sort());
        }
        
        // Results should be stable across runs - all runs should produce identical label sets
        for (let run = 1; run < runs; run++) {
            expect(allRunsLabels[run]).to.deep.equal(allRunsLabels[0]);
        }
    });
});