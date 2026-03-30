// Debug the sequence generation logic
console.log("Debugging sequence generation:");

// Simulate the tile array based on your debug output
const rainTiles = [
    { age_minutes: 0, originalData: "current" },
    { age_minutes: 15, originalData: "15min" },
    { age_minutes: 30, originalData: "30min" }
];

console.log("Original array:");
rainTiles.forEach((tile, index) => {
    console.log(`Index ${index}: age=${tile.age_minutes}min`);
});

// Replicate the sequence generation logic
const tilesWithIndices = rainTiles.map((tile, index) => ({ ...tile, originalIndex: index }));
const sortedByAge = [...tilesWithIndices].sort((a, b) => a.age_minutes - b.age_minutes); // oldest first

console.log("\nSorted by age (oldest first):");
sortedByAge.forEach((tile, i) => {
    console.log(`Position ${i}: originalIndex=${tile.originalIndex}, age=${tile.age_minutes}min`);
});

// Generate sequence
const sequence = [];
for (let i = 0; i < sortedByAge.length; i++) {
    sequence.push(sortedByAge[i].originalIndex);
}

console.log("\nGenerated sequence:", sequence);
console.log("Expected sequence: [2, 1, 0] (oldest to newest)");
console.log("Match:", JSON.stringify(sequence) === JSON.stringify([2, 1, 0]));

// Check if the issue is in the timing condition
console.log("\nTiming condition check:");
sequence.forEach((tileIndex, i) => {
    const isLast = i < sortedByAge.length - 1;
    const timing = isLast ? 500 : 3000;
    console.log(`Step ${i}: tile ${tileIndex} -> ${timing}ms (isLast: ${isLast})`);
});