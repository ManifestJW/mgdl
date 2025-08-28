/**
 * Basefactor for parameters a and b
 * basefactor = 1/(18000000/(100+minpoints)^2-50)
 * 
 * current basefactor for minpoints = 1
 */
const baseFactor = 0.0005832492374192035997815;

const scale = 1;

/**
 * Calculate the score awarded when having a certain percentage on a list level
 * @param {Number} rank Position on the list
 * @param {Number} percent Percentage of completion
 * @param {Number} minPercent Minimum percentage required
 * @Param {Number} levelCount Current number of levels
 * @returns {Number}
 */
export function score(rank, percent, minPercent, levelCount) {
    const maxScore = 250;
    const minScore = 10;

    // Slight exponential factor. 0.05 gives a subtle curve
    const expFactor = 1.5;

    // Normalize rank to [0, 1]
    const x = (rank - 1) / (levelCount - 1);

    // Smooth exponential curve
    const base = minScore + (maxScore - minScore) * Math.pow(1 - x, 1 + expFactor);

    // Adjust for completion percent
    const completionFactor = (percent - (minPercent - 1)) / (100 - (minPercent - 1));
    let finalScore = base * completionFactor;

    if (percent !== 100) {
        finalScore *= 2 / 3;
    }

    return round(Math.max(0, finalScore));
}

export function calculateScores(levelCount) {
    const maxScore = 250;
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

export function round(num) {
    if (!('' + num).includes('e')) {
        return +(Math.round(num + 'e+' + scale) + 'e-' + scale);
    } else {
        var arr = ('' + num).split('e');
        var sig = '';
        if (+arr[1] + scale > 0) {
            sig = '+';
        }
        return +(
            Math.round(+arr[0] + 'e' + sig + (+arr[1] + scale)) +
            'e-' +
            scale
        );
    }
}
