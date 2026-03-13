const MAX_SCORE = 600;
const MIN_SCORE = 10;
const K = 4.8; // Controls how quickly scores drop toward the minimum
const B = 0.7; // Shapes the exponential curve

const CLUSTER_BOUNDARIES_PERCENT = [0, 2, 14, 40, 60, 81, 98, 100];
const CLUSTER_BOUNDARIES = CLUSTER_BOUNDARIES_PERCENT.map((value) => value / 100);
const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 3;
const CLUSTER_COUNT = CLUSTER_BOUNDARIES.length - 1;

let scale = 1;

export function score(rank, levelCount) {
  if (levelCount <= 0) {
    return 0;
  }

  if (levelCount === 1) {
    return round(MAX_SCORE);
  }

  const metadata = buildClusterMetadata(levelCount);
  const effectiveRank = getEffectiveRank(rank, metadata, levelCount);
  return round(applyExponentialCurve(effectiveRank));
}

export function calculateScores(levelCount) {
  if (levelCount <= 0) {
    return [];
  }

  if (levelCount === 1) {
    return [round(MAX_SCORE)];
  }

  const metadata = buildClusterMetadata(levelCount);

  const scores = [];
  for (let rank = 1; rank <= levelCount; rank += 1) {
    const effectiveRank = getEffectiveRank(rank, metadata, levelCount);
    scores.push(round(applyExponentialCurve(effectiveRank)));
  }

  return scores;
}

function buildClusterMetadata(levelCount) {
  if (levelCount <= 1) {
    return {
      totalWeight: 1,
      clusters: [
        {
          start: 0,
          end: 1,
          width: 1,
          multiplier: 1,
          prefixWeight: 0,
          weight: 1,
        },
      ],
    };
  }

  const counts = new Array(CLUSTER_COUNT).fill(0);
  for (let rank = 1; rank <= levelCount; rank += 1) {
    const normalizedRank = (rank - 1) / (levelCount - 1);
    const index = getClusterIndex(normalizedRank);
    counts[index] += 1;
  }

  const avgCount = levelCount / CLUSTER_COUNT;

  const clusters = [];
  let prefixWeight = 0;

  for (let i = 0; i < CLUSTER_COUNT; i += 1) {
    const start = CLUSTER_BOUNDARIES[i];
    const end = CLUSTER_BOUNDARIES[i + 1];
    const width = Math.max(end - start, 0);
    const rawRatio = avgCount > 0 ? counts[i] / avgCount : 1;
    const multiplier = clamp(rawRatio, MIN_MULTIPLIER, MAX_MULTIPLIER);
    const weight = width * multiplier;

    clusters.push({
      start,
      end,
      width,
      multiplier,
      prefixWeight,
      weight,
    });

    prefixWeight += weight;
  }

  const totalWeight = prefixWeight > 0 ? prefixWeight : 1;
  return { totalWeight, clusters };
}

function getEffectiveRank(rank, metadata, levelCount) {
  if (!metadata || metadata.clusters.length === 0) {
    return 0;
  }

  const normalizedRank = levelCount <= 1 ? 0 : (rank - 1) / (levelCount - 1);
  const index = findClusterForRank(normalizedRank, metadata.clusters);
  const cluster = metadata.clusters[index];

  if (!cluster) {
    return 0;
  }

  const localDenominator = cluster.width || 1;
  const localRatio = clamp((normalizedRank - cluster.start) / localDenominator, 0, 1);
  const rawEffective = cluster.prefixWeight + cluster.weight * localRatio;
  return clamp(rawEffective / metadata.totalWeight, 0, 1);
}

function findClusterForRank(normalizedRank, clusters) {
  const clampedRank = clamp(normalizedRank, 0, 1);

  for (let i = 0; i < clusters.length; i += 1) {
    const { start, end } = clusters[i];
    if (clampedRank >= start && (i === clusters.length - 1 || clampedRank < end)) {
      return i;
    }
  }

  return clusters.length - 1;
}

function getClusterIndex(normalizedRank) {
  const clampedValue = clamp(normalizedRank, 0, 1);
  for (let i = 0; i < CLUSTER_COUNT; i += 1) {
    if (clampedValue < CLUSTER_BOUNDARIES[i + 1] || i === CLUSTER_COUNT - 1) {
      return i;
    }
  }
  return CLUSTER_COUNT - 1;
}

function applyExponentialCurve(effectiveRank) {
  const normalizedRank = clamp(effectiveRank, 0, 1);
  const expBase = Math.exp(-K * Math.pow(normalizedRank, B));
  const bottom = Math.exp(-K);
  const normalizedCurve = (expBase - bottom) / (1 - bottom);
  return MIN_SCORE + (MAX_SCORE - MIN_SCORE) * normalizedCurve;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function round(num) {
  if (!(`${num}`).includes('e')) {
    return +(Math.round(num + 'e+' + scale) + 'e-' + scale);
  } else {
    const arr = (`${num}`).split('e');
    const sig = +arr[1] + scale > 0 ? '+' : '';
    return +(
      Math.round(+arr[0] + 'e' + sig + (+arr[1] + scale)) + 'e-' + scale
    );
  }
}
