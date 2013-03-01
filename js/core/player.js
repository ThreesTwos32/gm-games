/**
 * @name core.player
 * @namespace Functions operating on player objects, or parts of player objects.
 */
define(["db", "util/random"], function (db, random) {
    "use strict";

    /**
     * Limit a rating to between 0 and 100.
     *
     * @memberOf core.player
     * @param {number} rating Input rating.
     * @return {number} If rating is below 0, 0. If rating is above 100, 100. Otherwise, rating.
     */
    function limitRating(rating) {
        if (rating > 100) {
            return 100;
        }
        if (rating < 0) {
            return 0;
        }
        return Math.floor(rating);
    }


    /**
     * Calculates the overall rating by averaging together all the other ratings.
     * 
     * @memberOf core.player
     * @param {Object.<string, number>} ratings Player's ratings object.
     * @return {number} Overall rating.
     */
    function ovr(ratings) {
        return Math.round((ratings.hgt + ratings.stre + ratings.spd + ratings.jmp + ratings.endu + ratings.ins + ratings.dnk + ratings.ft + ratings.fg + ratings.tp + ratings.blk + ratings.stl + ratings.drb + ratings.pss + ratings.reb) / 15);
    }

    /**
     * Assign "skills" based on ratings.
     *
     * "Skills" are discrete categories, like someone is a 3 point shooter or they aren't. These are displayed next to the player's name generally, and are also used in game simulation. The possible skills are:
     * 
     * * Three Point Shooter (3)
     * * Athlete (A)
     * * Ball Handler (B)
     * * Interior Defender (Di)
     * * Perimeter Defender (Dp)
     * * Post Scorer (Po)
     * * Passer (Ps)
     * * Rebounder (R)
     * 
     * @memberOf core.player
     * @param {Object.<string, number>} ratings Ratings object.
     * @return {Array.<string>} Array of skill IDs.
     */
    function skills(ratings) {
        var hasSkill, sk;

        sk = [];

        hasSkill = function (ratings, components, weights) {
            var denominator, i, numerator;

            if (weights === undefined) {
                // Default: array of ones with same size as components
                weights = [];
                for (i = 0; i < components.length; i++) {
                    weights.push(1);
                }
            }

            numerator = 0;
            denominator = 0;
            for (i = 0; i < components.length; i++) {
                numerator += ratings[components[i]] * weights[i];
                denominator += 100 * weights[i];
            }

            if (numerator / denominator > 0.75) {
                return true;
            }
            return false;
        };

        // Most of these use the same formulas as the composite rating definitions in core.game!
        if (hasSkill(ratings, ['hgt', 'tp'], [0.2, 1])) {
            sk.push("3");
        }
        if (hasSkill(ratings, ['stre', 'spd', 'jmp', 'hgt'], [1, 1, 1, 0.5])) {
            sk.push("A");
        }
        if (hasSkill(ratings, ['drb', 'spd'])) {
            sk.push("B");
        }
        if (hasSkill(ratings, ['hgt', 'stre', 'spd', 'jmp', 'blk'], [2, 1, 0.5, 0.5, 1])) {
            sk.push("Di");
        }
        if (hasSkill(ratings, ['hgt', 'stre', 'spd', 'jmp', 'stl'], [1, 1, 2, 0.5, 1])) {
            sk.push("Dp");
        }
        if (hasSkill(ratings, ['hgt', 'stre', 'spd', 'ins'], [1, 0.6, 0.2, 1])) {
            sk.push("Po");
        }
        if (hasSkill(ratings, ['drb', 'pss'], [0.4, 1])) {
            sk.push("Ps");
        }
        if (hasSkill(ratings, ['hgt', 'stre', 'jmp', 'reb'], [1, 0.1, 0.1, 0.7])) {
            sk.push("R");
        }

        return sk;
    }

    /**
     * Generate a contract for a player.
     * 
     * @memberOf core.player
     * @param {Object.<string, number>} ratings Ratings object.
     * @param {boolean} randomizeExp If true, then it is assumed that some random amount of years has elapsed since the contract was signed, thus decreasing the expiration date. This is used when generating players in a new league.
     * @return {Object.<string, number>} Object containing two properties with integer values, "amount" with the contract amount in thousands of dollars and "exp" with the contract expiration year.
     */
    function contract(ratings, randomizeExp) {
        var amount, expiration, maxAmount, minAmount, potentialDifference, years;

        randomizeExp = randomizeExp !== undefined ? randomizeExp : false;

        // Limits on yearly contract amount, in $1000's
        minAmount = 500;
        maxAmount = 20000;

        // Scale amount from 500k to 15mil, proportional to (ovr*2 + pot)*0.5 120-210
        amount = ((2.0 * ratings.ovr + ratings.pot) * 0.85 - 120) / (210 - 120);  // Scale from 0 to 1 (approx)
        amount = amount * (maxAmount - minAmount) + minAmount;  // Scale from 500k to 15mil
        amount *= random.gauss(1, 0.1);  // Randomize

        // Expiration
        // Players with high potentials want short contracts
        potentialDifference = Math.round((ratings.pot - ratings.ovr) / 4.0);
        years = 5 - potentialDifference;
        if (years < 2) {
            years = 2;
        }
        // Bad players can only ask for short deals
        if (ratings.pot < 40) {
            years = 1;
        } else if (ratings.pot < 50) {
            years = 2;
        } else if (ratings.pot < 60) {
            years = 3;
        }

        // Randomize expiration for contracts generated at beginning of new game
        if (randomizeExp) {
            years = random.randInt(1, years);
        }

        if (g.hasOwnProperty("season")) {
            expiration = g.season + years - 1;
        } else {
            expiration = g.startingSeason + years - 1;
        }
        if (amount < minAmount) {
            amount = minAmount;
        } else if (amount > maxAmount) {
            amount = maxAmount;
        } else {
            amount = 50 * Math.round(amount / 50);  // Make it a multiple of 50k
        }

        return {amount: amount, exp: expiration};
    }

    /**
     * Develop (increase/decrease) player's ratings. This operates on whatever the last row of p.ratings is.
     * 
     * @memberOf core.player
     * @param {Object} p Player object.
     * @param {number} years Number of years to develop (default 1).
     * @param {generate} generate Generating a new player? (default false). If true, then the player's age is also updated based on years.
     * @return {Object} Updated player object.
     */
    function develop(p, years, generate) {
        var age, baseChange, i, j, ratingKeys, r, sigma;

        years = years !== undefined ? years : 1;
        generate = generate !== undefined ? generate : false;

        r = p.ratings.length - 1;

        // Make sure age is always defined
        if (g.hasOwnProperty("season")) {
            age = g.season - p.bornYear;
        } else {
            age = g.startingSeason - p.bornYear;
        }

        for (i = 0; i < years; i++) {
            age += 1;

            // Randomly make a big jump
            if (Math.random() > 0.985 && age < 22) {
                p.ratings[r].pot += 10;
            }

            // Variance of ratings change is proportional to the potential difference
            sigma = (p.ratings[r].pot - p.ratings[r].ovr) / 10;

            // 60% of the time, improve. 20%, regress. 20%, stay the same
            baseChange = random.gauss(random.randInt(-1, 3), sigma);

            // Bound possible changes
            if (baseChange > 30) {
                baseChange = 30;
            } else if (baseChange < -5) {
                baseChange = -5;
            }
            if (baseChange + p.ratings[r].pot > 95) {
                baseChange = 95 - p.ratings[r].pot;
            }

            // Modulate by potential difference, but only for growth, not regression
            if (baseChange > 0) {
                baseChange *= 1 + (p.ratings[r].pot - p.ratings[r].ovr) / 8;
            }

            // Modulate by age
            if (age > 23) {
                baseChange /= 3;
            }
            if (age > 29) {
                baseChange -= 1;
            }
            if (age > 31) {
                baseChange -= 1;
            }
            if (age > 33) {
                baseChange -= 1;
            }

            ratingKeys = ['stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'fg', 'tp', 'blk', 'stl', 'drb', 'pss', 'reb'];
            for (j = 0; j < ratingKeys.length; j++) {
                //increase = plusMinus
                p.ratings[r][ratingKeys[j]] = limitRating(p.ratings[r][ratingKeys[j]] + random.gauss(1, 2) * baseChange);
            }

            // Update overall and potential
            p.ratings[r].ovr = ovr(p.ratings[r]);
            p.ratings[r].pot += -2 + Math.round(random.gauss(0, 2));
            if (p.ratings[r].ovr > p.ratings[r].pot || age > 28) {
                p.ratings[r].pot = p.ratings[r].ovr;
            }

            // Skills
            p.ratings[r].skills = skills(p.ratings[r]);
        }

        // If this isn't here outside the loop, then 19 year old players could still have ovr > pot
        if (p.ratings[r].ovr > p.ratings[r].pot || age > 28) {
            p.ratings[r].pot = p.ratings[r].ovr;
        }

        if (generate) {
            if (g.hasOwnProperty("season")) {
                age = g.season - p.bornYear + years;
                p.bornYear = g.season - age;
            } else {
                age = g.startingSeason - p.bornYear + years;
                p.bornYear = g.startingSeason - age;
            }
        }

        return p;
    }

    /**
     * Add or subtract amount from all current ratings and update the player's contract appropriately.
     * 
     * This should only be called when generating players for a new league. Otherwise, develop should be used. 
     * 
     * @memberOf core.player
     * @param {Object} p Player object.
     * @param {number} amount Number to be added to each rating (can be negative).
     * @param {boolean} randomizeExp Should the number of years on the player's contract be randomized?.
     * @return {Object} Updated player object.
     */
    function bonus(p, amount, randomizeExp) {
        var age, cont, i, key, r, ratingKeys;

        // Make sure age is always defined
        if (g.hasOwnProperty("season")) {
            age = g.season - p.bornYear;
        } else {
            age = g.startingSeason - p.bornYear;
        }

        r = p.ratings.length - 1;

        ratingKeys = ['stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'fg', 'tp', 'blk', 'stl', 'drb', 'pss', 'reb', 'pot'];
        for (i = 0; i < ratingKeys.length; i++) {
            key = ratingKeys[i];
            p.ratings[r][key] = limitRating(p.ratings[r][key] + amount);
        }

        // Update overall and potential
        p.ratings[r].ovr = ovr(p.ratings[r]);
        if (p.ratings[r].ovr > p.ratings[r].pot || age > 28) {
            p.ratings[r].pot = p.ratings[r].ovr;
        }

        // Update contract based on development
        cont = contract(p.ratings[r], randomizeExp);
        p.contractAmount = cont.amount;
        p.contractExp = cont.exp;

        return p;
    }

    /**
     * Adds player to the free agents list.
     * 
     * This should be THE ONLY way that players are added to the free agents
     * list, because this will also calculate their demanded contract. But
     * currently, the free agents generated at the beginning of the game don't
     * use this function.
     * 
     * @memberOf core.player
     * @param {(IDBObjectStore|IDBTransaction|null)} ot An IndexedDB object store or transaction on players readwrite; if null is passed, then a new transaction will be used.
     * @param {Object} p Player object.
     * @param {?number} phase An integer representing the game phase to consider this transaction under (defaults to g.phase if null).
     * @param {function()} cb Callback function.
     */
    function addToFreeAgents(ot, p, phase, cb) {
        var cont, expiration;

        phase = phase !== null ? phase : g.phase;

        cont = contract(p.ratings[p.ratings.length - 1]);
        p.contractAmount = cont.amount;
        p.contractExp = cont.exp;

        p.freeAgentTimesAsked = 0;

        // During regular season, or before season starts, allow contracts for
        // just this year.
        if (g.phase > c.PHASE_AFTER_TRADE_DEADLINE) {
            p.contractExp += 1;
        }

        p.tid = c.PLAYER_FREE_AGENT;

        db.putPlayer(ot, p, cb);
    }

    /**
     * Release player.
     * 
     * This keeps track of what the player's current team owes him, and then calls player.addToFreeAgents.
     * 
     * @memberOf core.player
     * @param {IDBTransaction} transaction An IndexedDB transaction on players and releasedPlayers, readwrite.
     * @param {Object} p Player object.
     * @param {function()} cb Callback function.
     */
    function release(transaction, p, cb) {
        // Keep track of player salary even when he's off the team
        transaction.objectStore("releasedPlayers").add({
            pid: p.pid,
            tid: p.tid,
            contractAmount: p.contractAmount,
            contractExp: p.contractExp
        });

        addToFreeAgents(transaction, p, g.phase, cb);
    }

    function generateRatings(profile, baseRating, pot, season) {
        var i, key, profileId, profiles, ratingKeys, ratings, rawRating, rawRatings, sigmas;

        if (profile === 'Point') {
            profileId = 1;
        } else if (profile === 'Wing') {
            profileId = 2;
        } else if (profile === 'Big') {
            profileId = 3;
        } else {
            profileId = 0;
        }

        // Each row should sum to ~150
        profiles = [[10,  10,  10,  10,  10,  10,  10,  10,  10,  25,  10,  10,  10,  10,  10],  // Base 
                    [-30, -10, 40,  15,  0,   0,   0,   10,  15,  15,   0,   20,  40,  40,  0],   // Point Guard
                    [10,  10,  15,  15,  0,   0,   25,  15,  15,  20,   0,   10,  15,  0,   15],  // Wing
                    [50,  35,  -10, -10, 0,  35,  35,  0,   -10, -15, 30,  0,   -10, -10, 35]];  // Big
        sigmas = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
        baseRating = random.gauss(baseRating, 5);

        rawRatings = [];
        for (i = 0; i < sigmas.length; i++) {
            rawRating = profiles[profileId][i] + baseRating;
            rawRatings[i] = limitRating(random.gauss(rawRating, sigmas[i]));
        }

        ratings = {};
        ratingKeys = ['hgt', 'stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'fg', 'tp', 'blk', 'stl', 'drb', 'pss', 'reb'];
        for (i = 0; i < ratingKeys.length; i++) {
            key = ratingKeys[i];
            ratings[key] = rawRatings[i];
        }

        ratings.season = season;
        ratings.ovr = ovr(ratings);
        ratings.pot = pot;

        ratings.skills = skills(ratings);

        return ratings;
    }

    function name(nationality) {
        var fn, fnRand, i, ln, lnRand;

        // First name
        fnRand = random.uniform(0, 90.04);
        for (i = 0; i < g.firstNames.length; i++) {
            //if row[4].upper() == nationality.upper():
            if (g.firstNames[i][2] >= fnRand) {
                break;
            }
        }
        fn = g.firstNames[i][0];
        fn = fn.charAt(0).toUpperCase() + fn.substring(1).toLowerCase();


        // Last name
        lnRand = random.uniform(0, 77.48);
        for (i = 0; i < g.lastNames.length; i++) {
            //if row[4].upper() == nationality.upper():
            if (g.lastNames[i][2] >= lnRand) {
                break;
            }
        }
        ln = g.lastNames[i][0];
        ln = ln.charAt(0).toUpperCase() + ln.substring(1).toLowerCase();
        // McWhatever
        if (ln.substring(0, 2) === 'Mc') {
            ln = ln.substring(0, 2) + ln.charAt(2).toUpperCase() + ln.substring(3);
        }

        return fn + " " + ln;
    }

    /**
     * Assign a position (PG, SG, SF, PF, C, G, GF, FC) based on ratings.
     * 
     * @memberOf core.player
     * @param {Object.<string, number>} ratings Ratings object.
     * @return {string} Position.
     */
    function pos(ratings) {
        var c, g, pf, pg, position, sf, sg;

        g = false;
        pg = false;
        sg = false;
        sf = false;
        pf = false;
        c = false;

        // Default position
        if (ratings.drb >= 50) {
            position = 'GF';
        } else {
            position = 'F';
        }

        if (ratings.hgt <= 30 || ratings.spd >= 85) {
            g = true;
            if ((ratings.pss + ratings.drb) >= 100) {
                pg = true;
            }
            if (ratings.hgt >= 30) {
                sg = true;
            }
        }
        if (ratings.hgt >= 50 && ratings.hgt <= 65 && ratings.spd >= 40) {
            sf = true;
        }
        if (ratings.hgt >= 70) {
            pf = true;
        }
        if ((ratings.hgt + ratings.stre) >= 130) {
            c = true;
        }

        if (pg && !sg && !sf && !pf && !c) {
            position = 'PG';
        } else if (!pg && (g || sg) && !sf && !pf && !c) {
            position = 'SG';
        } else if (!pg && !sg && sf && !pf && !c) {
            position = 'SF';
        } else if (!pg && !sg && !sf && pf && !c) {
            position = 'PF';
        } else if (!pg && !sg && !sf && !pf && c) {
            position = 'C';
        }

        // Multiple poss
        if ((pf || sf) && g) {
            position = 'GF';
        } else if (c && (pf || sf)) {
            position = 'FC';
        } else if (pg && sg) {
            position = 'G';
        }
        if (position === 'F' && ratings.drb <= 20) {
            position = 'PF';
        }

        return position;
    }

    /**
     * Add a new row of ratings to a player object.
     * 
     * There should be one ratings row for each year a player is not retired, and a new row should be added for each non-retired player at the start of a season.
     *
     * @memberOf core.player
     * @param {Object} p Player object.
     * @return {Object} Updated player object.
     */
    function addRatingsRow(p) {
        var key, newRatings, r;

        newRatings = {};
        r = p.ratings.length - 1; // Most recent ratings
        for (key in p.ratings[r]) {
            if (p.ratings[r].hasOwnProperty(key)) {
                newRatings[key] = p.ratings[r][key];
            }
        }
        newRatings.season = g.season;
        p.ratings.push(newRatings);

        return p;
    }

    /**
     * Add a new row of stats to a player object.
     * 
     * A row contains stats for unique values of (team, season, playoffs). So new rows need to be added when a player joins a new team, when a new season starts, or when a player's team makes the playoffs. The team ID in p.tid will be used in the stats row, so if a player is changing teams, update p.tid before calling this.
     *
     * @memberOf core.player
     * @param {Object} p Player object.
     * @param {=boolean} playoffs Is this stats row for the playoffs or not? Default false.
     * @param {=season} season The season for the stats row. Defaults to g.season. This option should probably be eliminated eventually, as g.season should always be set.
     * @return {Object} Updated player object.
     */
    function addStatsRow(p, playoffs, season) {
        var key, newStats;

        playoffs = playoffs !== undefined ? playoffs : false;
        season = season !== undefined ? season : g.season;

        p.stats.push({season: season, tid: p.tid, playoffs: playoffs, gp: 0, gs: 0, min: 0, fg: 0, fga: 0, fgAtRim: 0, fgaAtRim: 0, fgLowPost: 0, fgaLowPost: 0, fgMidRange: 0, fgaMidRange: 0, tp: 0, tpa: 0, ft: 0, fta: 0, orb: 0, drb: 0, trb: 0, ast: 0, tov: 0, stl: 0, blk: 0, pf: 0, pts: 0, per: 0});
        p.statsTids.push(p.tid);
        p.statsTids = _.uniq(p.statsTids);

        return p;
    }

    function generate(tid, age, profile, baseRating, pot, draftYear, newLeague) {
        var cont, maxHgt, minHgt, maxWeight, minWeight, nationality, p;

        newLeague = newLeague !== undefined ? newLeague : false;

        p = {}; // Will be saved to database
        p.tid = tid;
        p.statsTids = [];
        p.stats = [];
        if (tid >= 0) {
            // This only happens when generating random players for a new league, so g.startingSeason can be safely used rather than g.draftYear
            addStatsRow(p, false, g.startingSeason);
        }
        p.rosterOrder = 666;  // Will be set later
        p.ratings = [];
        if (newLeague) {
            // Create player for new league
            p.ratings.push(generateRatings(profile, baseRating, pot, g.startingSeason));
        } else {
            // Create player to be drafted
            p.ratings.push(generateRatings(profile, baseRating, pot, draftYear));
        }

        minHgt = 69;  // 5'9"
        maxHgt = 89;  // 7'5"
        minWeight = 150;
        maxWeight = 290;

        p.pos = pos(p.ratings[0]);  // Position (PG, SG, SF, PF, C, G, GF, FC)
        p.hgt = parseInt(random.gauss(1, 0.02) * (p.ratings[0].hgt * (maxHgt - minHgt) / 100 + minHgt), 10);  // Height in inches (from minHgt to maxHgt)
        p.weight = parseInt(random.gauss(1, 0.02) * ((p.ratings[0].hgt + 0.5 * p.ratings[0].stre) * (maxWeight - minWeight) / 150 + minWeight), 10);  // Weight in pounds (from minWeight to maxWeight)
        if (g.hasOwnProperty('season')) {
            p.bornYear = g.season - age;
        } else {
            p.bornYear = g.startingSeason - age;
        }

        // Randomly choose nationality  
        nationality = 'USA';

        p.bornLoc = nationality;
        p.name = name(nationality);

        p.college = 0;
        p.draftRound = 0;
        p.draftPick = 0;
        p.draftTid = 0;
        p.draftYear = draftYear;
        p.draftAbbrev = null;
        p.draftTeamName = null;
        p.draftTeamRegion = null;
        cont = contract(p.ratings[0]);
        p.contractAmount = cont.amount;
        p.contractExp = cont.exp;

        p.freeAgentTimesAsked = 0;
        p.yearsFreeAgent = 0;
        p.retiredYear = null;

        p.draftPot = pot;
        p.draftOvr = p.ratings[0].ovr;

        p.face = faces.generate();

        return p;
    }

    return {
        addRatingsRow: addRatingsRow,
        addStatsRow: addStatsRow,
        addToFreeAgents: addToFreeAgents,
        bonus: bonus,
        contract: contract,
        develop: develop,
        generate: generate,
        ovr: ovr,
        release: release,
        skills: skills
    };
});