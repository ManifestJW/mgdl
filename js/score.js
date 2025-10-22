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
    const maxScore = 500;
    const minScore = 10;
    const expFactor = 1.5;

    // Normalize rank to [0, 1]
    const x = (rank - 1) / (levelCount - 1);

    // Smooth exponential curve for base score
    const base = minScore + (maxScore - minScore) * Math.pow(1 - x, 1 + expFactor);

    let completionFactor;

    if (percent < minPercent) {
        // Below allowed progress, give no points
        completionFactor = 0;
    } else if (percent >= 100) {
        // Full completion = 100%
        completionFactor = 1.0;
    } else if (percent >= 99) {
        // 99% to 100% scales from 0.5 → 1.0
        completionFactor = 0.5 + (percent - 99) * 0.5;
    } else {
        // Between minPercent and 99%
        // Scales linearly from 0.1 at minPercent → 0.5 at 99%
        completionFactor = 0.1 + ((percent - minPercent) / (99 - minPercent)) * (0.5 - 0.1);
    }

    const finalScore = round(base * completionFactor);
    return Math.max(0, finalScore);
}

export function calculateScores(levelCount) {
    const maxScore = 500;
    const minScore = 10;
    const expFactor = 1.5;

    let scores = [];
    for (let rank = 1; rank <= levelCount; ++rank) {
         // Normalize rank to [0, 1]
        const x = (rank - 1) / (levelCount - 1);
        
        // Smooth exponential curve for base score
        const base = minScore + (maxScore - minScore) * Math.pow(1 - x, 1 + expFactor);
        
        let completionFactor;
        
        if (percent < minPercent) {
            // Below allowed progress, give no points
            completionFactor = 0;
        } else if (percent >= 100) {
            // Full completion = 100%
            completionFactor = 1.0;
        } else if (percent >= 99) {
            // 99% to 100% scales from 0.5 → 1.0
            completionFactor = 0.5 + (percent - 99) * 0.5;
        } else {
            // Between minPercent and 99%
            // Scales linearly from 0.1 at minPercent → 0.5 at 99%
            completionFactor = 0.1 + ((percent - minPercent) / (99 - minPercent)) * (0.5 - 0.1);
        }
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
