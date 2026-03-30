// Fresh debug of the sequence issue
console.log("=== Debugging Animation Sequence Issue ===");

// Based on your observation: animation goes 0 -> 2 -> 1
// But we want: 2 (30min) -> 1 (15min) -> 0 (current)

const rainTiles = [
    { age_minutes: 0 },   // Index 0: current
    { age_minutes: 15 },  // Index 1: 15min
    { age_minutes: 30 }   // Index 2: 30min (oldest)
];

console.log("Step 1: Original tile array");
rainTiles.forEach((tile, i) => console.log(`  Index ${i}: ${tile.age_minutes}min`));

console.log("\nStep 2: Add original indices");
const tilesWithIndices = rainTiles.map((tile, index) => ({ ...tile, originalIndex: index }));
tilesWithIndices.forEach((tile, i) => 
    console.log(`  Position ${i}: originalIndex=${tile.originalIndex}, age=${tile.age_minutes}min`)
);

console.log("\nStep 3: Sort by age DESCENDING (oldest first)");
const sortedByAge = [...tilesWithIndices].sort((a, b) => b.age_minutes - a.age_minutes);
sortedByAge.forEach((tile, i) => 
    console.log(`  Position ${i}: originalIndex=${tile.originalIndex}, age=${tile.age_minutes}min`)
);

console.log("\nStep 4: Generate sequence");
const sequence = [];
for (let i = 0; i < sortedByAge.length; i++) {
    sequence.push(sortedByAge[i].originalIndex);
    console.log(`  Step ${i}: use originalIndex ${sortedByAge[i].originalIndex} (age=${sortedByAge[i].age_minutes}min)`);
}

console.log("\nFinal sequence:", sequence);
console.log("Expected: [2, 1, 0] (oldest to newest)");
console.log("Match:", JSON.stringify(sequence) === JSON.stringify([2, 1, 0]));

if (JSON.stringify(sequence) !== JSON.stringify([2, 1, 0])) {
    console.log("\n❌ Sequence is wrong!");
    console.log("This means the sorting or indexing is incorrect.");
} else {
    console.log("\n✅ Sequence is correct!");
    console.log("The animation should show: 30min -> 15min -> current");
}