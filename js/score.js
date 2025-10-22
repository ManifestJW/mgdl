
let scale = 1;

export function score(rank, levelCount) {
  const maxScore = 500;
  const minScore = 10;

  // Slight exponential factor. 1.5 gives a strong curve.
  const expFactor = 1.5;

  // Normalize rank to [0, 1]
  const x = (rank - 1) / (levelCount - 1);

  // Smooth exponential curve
  const score = minScore + (maxScore - minScore) * Math.pow(1 - x, 1 + expFactor);

  return round(Math.max(0, score));
}

/**
 * Calculate base scores for all ranks
 * @param {Number} levelCount - Number of levels
 * @returns {Number[]}
 */
export function calculateScores(levelCount) {
  const maxScore = 500;
  const minScore = 10;
  const expFactor = 1.5;

  let scores = [];

  for (let rank = 1; rank <= levelCount; ++rank) {
    const x = (rank - 1) / (levelCount - 1);
    const score = minScore + (maxScore - minScore) * Math.pow(1 - x, 1 + expFactor);
    scores.push(round(score));
  }

  return scores;
}

/**
 * Round a number to a specific number of decimal places
 * @param {Number} num - The number to round
 * @returns {Number}
 */
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
