/* ============================================================
   Animal Battle Champions - Game Data (single source of truth)
   24 animals x 3 moves, category matchup matrix, 8-boss ladder,
   AI profiles, tuning constants.

   UMD: `module.exports` in node (engine tests), `window.GameData`
   in the browser. Pure data + tiny helpers; no DOM, no state.

   CATEGORY TRIANGLE:  Attack > Special > Defense > Attack
     - Attack vs Special : x1.5 and DISRUPTS the special (halves its
       numeric potency if the special has not resolved yet this round)
     - Special vs Defense: x1.5 and NEGATES the defense's riders
       (block/counter/thorns/heal-on-block do nothing; evade at half)
     - Defense vs Attack : x0.5 for the attacker, then defense riders
       apply (block -> 0, counter/thorns, heal-on-block, full evade %)

   MOVE EFFECT VOCABULARY (implemented by engine.js):
     power, acc          damaging move (standard formula), acc rolled first
     useStat             'def' -> use DEF as the attacking stat (turtle)
     hits                multi-hit: `hits` strikes of `power` each,
                         accuracy rolled per hit
     lifesteal: f        heal attacker f * damage dealt
     recoil: n           attacker takes n flat after the move
     bonusIfUntouched: f +f fraction damage if user took no damage last round
     flatDamage          fixed damage (no ATK/DEF scaling); still rolls acc
                         and applies the category multiplier
     echoLastBossDamage  flatDamage = total damage the boss dealt last
                         round, capped at `cap`
     heal / healAll      flat self-heal / heal all deployed allies
     shieldAll: n        n-HP shield on all deployed allies
                         (TUNING.SHIELD_DURATION rounds or until broken)
     regen: {amount, turns}   end-of-round self-heal ticks
     dot: {dmg, turns}   poison on the target; ticks end of round,
                         ignores DEF and category math; reapply refreshes
     buffSelf/buffAll: {stat, pct, turns}
     debuff: {stat, pct|flat, turns}     on the boss (acc uses flat)
     luckBuff: {dmgPct, turns}           allies cannot miss, +dmgPct damage
     taunt: turns        boss must target this animal
     untargetable: turns rabbit: takes NO damage until end of next round
     chargeTurns: 1      this round = telegraph; next round the release
                         auto-fires (forced action, category special)
     revivePct           dolphin: revive a fainted animal (any party) at
                         revivePct of maxHp; oncePerBattle; if nobody is
                         fainted, fallbackHealAll instead
     revealBossNext      owl Foresight: reveal the boss's already-committed
                         next-round category to the whole party
     roulette: [...]     dodo: equal-chance random outcome list
     cd: n               special cooldown: unusable for n rounds after use

   DEFENSE RIDER VOCABULARY:
     block: true         Attack-category damage -> 0 this round
     evade: pct          pct chance to fully dodge any incoming hit
                         (halved vs Specials); on dodge, onEvade riders fire
     counter: n          flat n back at an attacker whose hit was blocked
     thorns: n           flat n back at any attacker that lands a hit
     reflectPct/reflectCap  reflect pct of pre-block damage, capped
     teamGuard: f        redirect a boss SINGLE-TARGET hit aimed at an ally
                         to this animal at f of the damage (no AoE guard)
     healOnBlock/healOnEvade: n
     counterOnEvade: n
     buffOnEvade/debuffOnEvade/debuffOnBlock: {...}
     extraReduce: f      multiply post-matrix damage by f (goat: 0.5 -> 25%)
     debuffImmune: true  immune to debuffs this round
     heal: n             unconditional self-heal (croc basks either way)
     All counters/thorns/reflect are FLAT, capped at TUNING.FLAT_RIDER_CAP,
     and exempt from category multipliers (no recursion).
   ============================================================ */
(function (exports) {
  'use strict';

  // === CATEGORIES ==========================================================
  var CATS = { ATTACK: 'attack', DEFENSE: 'defense', SPECIAL: 'special' };

  // Damage multiplier: MATCHUP[moveCat][targetLockedCat]
  // 'none' = target is switching in / has no category this round.
  var MATCHUP = {
    attack:  { attack: 1.0, defense: 0.5, special: 1.5, none: 1.0 },
    special: { attack: 0.5, defense: 1.5, special: 1.0, none: 1.0 }
    // defense deals no direct damage; its riders are flat and exempt.
  };

  var CAT_LABELS = { attack: 'Attack', defense: 'Defend', special: 'Special' };
  var CAT_VERBS = {           // resolution callouts, colored by the winner
    attackBeatsSpecial: 'CUT THROUGH!',
    specialBeatsDefense: 'PIERCED!',
    defenseBeatsAttack: 'BLOCKED!',
    clash: 'CLASH!'
  };

  // === TUNING KNOBS ========================================================
  var TUNING = {
    DMG_ROLL_MIN: 0.85,        // damage = (ATK/DEF)*power*0.5*catMult*roll
    DMG_ROLL_MAX: 1.0,
    DISRUPT_POTENCY: 0.5,      // disrupted specials: numeric potency x0.5
    EVADE_VS_SPECIAL: 0.5,     // evade chance multiplier vs Special moves
    FLAT_RIDER_CAP: 30,        // max counter/thorns/reflect per hit
    STAT_MOD_CLAMP: 0.5,       // net stat modifier clamped to +/-50%
    ACC_MIN: 30, ACC_MAX: 100, // accuracy clamp after debuffs
    SHIELD_DURATION: 3,        // rounds a shield lasts (or until broken)
    DARK_WILL_FACTOR: 0.5,     // rungs 5-8: incoming debuff magnitude x0.5
    COMPANION_BLUNDER: 0.15,   // AI friend picks 2nd-best this often
    SWITCH_DEADLINE_S: 25,     // online: force-switch auto-pick deadline
    STAT_TOTAL: 260            // every player animal's stats sum to this
  };

  // === ANIMALS (hp+atk+def+spd === 260 for all 24) =========================
  // Sprite art + nickname pools live in sprites.js (SpriteEngine), keyed by
  // these same ids. `class` is cosmetic grouping only - zero gameplay effect.
  var ANIMALS = {
    bear:      { id: 'bear',      name: 'Bear',      hp: 95,  atk: 75, def: 55, spd: 35, archetype: 'BRUISER',   class: 'wild',    desc: 'A mountain of muscle with a marshmallow heart.' },
    cat:       { id: 'cat',       name: 'Cat',       hp: 60,  atk: 65, def: 40, spd: 95, archetype: 'SPEEDSTER', class: 'critter', desc: 'Nine lives, zero patience.' },
    owl:       { id: 'owl',       name: 'Owl',       hp: 65,  atk: 60, def: 45, spd: 90, archetype: 'SUPPORT',   class: 'sky',     desc: 'Sees every move before it happens.' },
    penguin:   { id: 'penguin',   name: 'Penguin',   hp: 85,  atk: 55, def: 70, spd: 50, archetype: 'TANK',      class: 'aquatic', desc: 'An unshakeable wall of tuxedoed courage.' },
    raccoon:   { id: 'raccoon',   name: 'Raccoon',   hp: 70,  atk: 60, def: 55, spd: 75, archetype: 'BALANCED',  class: 'critter', desc: "If it's not nailed down, it's his." },
    frog:      { id: 'frog',      name: 'Frog',      hp: 65,  atk: 55, def: 50, spd: 90, archetype: 'SPEEDSTER', class: 'critter', desc: 'Slippery, springy, and secretly toxic.' },
    dog:       { id: 'dog',       name: 'Dog',       hp: 80,  atk: 70, def: 55, spd: 55, archetype: 'BALANCED',  class: 'wild',    desc: 'Loyal to the last bark.' },
    panda:     { id: 'panda',     name: 'Panda',     hp: 100, atk: 60, def: 70, spd: 30, archetype: 'TANK',      class: 'wild',    desc: 'Unbothered. Unmovable. Snacking.' },
    monkey:    { id: 'monkey',    name: 'Monkey',    hp: 60,  atk: 75, def: 40, spd: 85, archetype: 'CANNON',    class: 'wild',    desc: 'Chaos with opposable thumbs.' },
    deer:      { id: 'deer',      name: 'Deer',      hp: 70,  atk: 55, def: 50, spd: 85, archetype: 'SUPPORT',   class: 'wild',    desc: 'Grace under fire, healing on the hoof.' },
    hedgehog:  { id: 'hedgehog',  name: 'Hedgehog',  hp: 75,  atk: 50, def: 80, spd: 55, archetype: 'TANK',      class: 'critter', desc: 'A rolling fortress of spikes.' },
    shark:     { id: 'shark',     name: 'Shark',     hp: 75,  atk: 85, def: 45, spd: 55, archetype: 'CANNON',    class: 'aquatic', desc: 'Never stops moving. Never stops biting.' },
    octopus:   { id: 'octopus',   name: 'Octopus',   hp: 80,  atk: 60, def: 65, spd: 55, archetype: 'SUPPORT',   class: 'aquatic', desc: 'Eight arms, three hearts, one brilliant mind.' },
    hamster:   { id: 'hamster',   name: 'Hamster',   hp: 55,  atk: 65, def: 45, spd: 95, archetype: 'SPEEDSTER', class: 'critter', desc: 'Fastest wheels in the west.' },
    parrot:    { id: 'parrot',    name: 'Parrot',    hp: 65,  atk: 55, def: 45, spd: 95, archetype: 'SUPPORT',   class: 'sky',     desc: 'Repeats your attacks back at you. Rudely.' },
    turtle:    { id: 'turtle',    name: 'Turtle',    hp: 90,  atk: 40, def: 90, spd: 40, archetype: 'TANK',      class: 'aquatic', desc: 'The oldest shell in the game.' },
    goat:      { id: 'goat',      name: 'Goat',      hp: 80,  atk: 75, def: 60, spd: 45, archetype: 'BRUISER',   class: 'wild',    desc: 'Head-first into everything, always.' },
    spider:    { id: 'spider',    name: 'Spider',    hp: 55,  atk: 80, def: 45, spd: 80, archetype: 'CANNON',    class: 'critter', desc: 'Patient, precise, venomous.' },
    ladybug:   { id: 'ladybug',   name: 'Ladybug',   hp: 60,  atk: 50, def: 60, spd: 90, archetype: 'SUPPORT',   class: 'critter', desc: 'Small body. Enormous luck.' },
    bee:       { id: 'bee',       name: 'Bee',       hp: 55,  atk: 75, def: 35, spd: 95, archetype: 'CANNON',    class: 'critter', desc: 'All-in on every sting.' },
    crocodile: { id: 'crocodile', name: 'Crocodile', hp: 90,  atk: 80, def: 60, spd: 30, archetype: 'BRUISER',   class: 'wild',    desc: 'An ambush 200 million years in the making.' },
    dolphin:   { id: 'dolphin',   name: 'Dolphin',   hp: 75,  atk: 65, def: 50, spd: 70, archetype: 'SUPPORT',   class: 'aquatic', desc: "The ocean's lifeguard." },
    rabbit:    { id: 'rabbit',    name: 'Rabbit',    hp: 60,  atk: 60, def: 45, spd: 95, archetype: 'SPEEDSTER', class: 'critter', desc: "Blink and it's behind you." },
    dodo:      { id: 'dodo',      name: 'Dodo',      hp: 85,  atk: 45, def: 55, spd: 75, archetype: 'SUPPORT',   class: 'sky',     desc: 'Extinction was just a setback.' }
  };

  // === MOVES: 24 animals x { attack, defense, special } ====================
  var MOVES = {
    bear: {
      attack:  { name: 'Haymaker Swipe', cat: 'attack', power: 55, acc: 90, desc: 'A colossal paw strike.' },
      defense: { name: 'Grizzly Guard', cat: 'defense', block: true, desc: 'Full block: Attack damage is reduced to zero.' },
      special: { name: 'Hibernal Surge', cat: 'special', heal: 35, cd: 1, desc: 'Deep-breath recovery: heal self 35 HP.' }
    },
    cat: {
      attack:  { name: 'Nine-Claw Rake', cat: 'attack', power: 45, acc: 100, desc: 'Lightning claw swipes.' },
      defense: { name: 'Nine Lives Poise', cat: 'defense', evade: 75, desc: '75% chance to fully evade incoming hits.' },
      special: { name: 'Feline Flurry', cat: 'special', hits: 3, power: 14, acc: 100, cd: 1, desc: 'Three rapid scratches, each rolled separately.' }
    },
    owl: {
      attack:  { name: 'Talon Dive', cat: 'attack', power: 50, acc: 95, desc: 'A silent plunging strike.' },
      defense: { name: 'Silent Wings', cat: 'defense', evade: 70, desc: '70% evade on noiseless wings.' },
      special: { name: 'Foresight', cat: 'special', revealBossNext: true, cd: 2, desc: "Reveals the boss's next move category to the whole party." }
    },
    penguin: {
      attack:  { name: 'Belly Slam', cat: 'attack', power: 45, acc: 100, desc: 'A sliding full-body check.' },
      defense: { name: 'Iceberg Wall', cat: 'defense', teamGuard: 0.50, desc: "Redirects a boss hit on an ally to penguin at half damage." },
      special: { name: 'Huddle Up', cat: 'special', shieldAll: 15, cd: 2, desc: 'All allies gain a 15-HP shield.' }
    },
    raccoon: {
      attack:  { name: 'Trash Panda Swipe', cat: 'attack', power: 45, acc: 100, desc: 'Grubby but effective claws.' },
      defense: { name: 'Lid Shield', cat: 'defense', block: true, counter: 8, desc: 'Full block; clangs the lid for 8 counter damage.' },
      special: { name: 'Sticky Fingers', cat: 'special', power: 30, acc: 100, debuff: { stat: 'atk', pct: -15, turns: 2 }, cd: 1, desc: 'Damages and pilfers power: boss ATK -15% for 2 rounds.' }
    },
    frog: {
      attack:  { name: 'Tongue Lash', cat: 'attack', power: 45, acc: 100, desc: 'A whip-crack tongue strike.' },
      defense: { name: 'Slippery Skin', cat: 'defense', evade: 70, desc: '70% evade - too slick to grab.' },
      special: { name: 'Toxic Skin', cat: 'special', acc: 90, dot: { dmg: 8, turns: 3 }, cd: 1, desc: 'Coats the boss in poison: 8 damage a round for 3 rounds.' }
    },
    dog: {
      attack:  { name: 'Loyal Chomp', cat: 'attack', power: 50, acc: 95, desc: 'A faithful, ferocious bite.' },
      defense: { name: 'Guard Dog', cat: 'defense', teamGuard: 0.60, desc: 'Redirects a boss hit on an ally to dog at 60% damage.' },
      special: { name: 'Rallying Bark', cat: 'special', buffAll: { stat: 'atk', pct: 25, turns: 2 }, cd: 2, desc: 'Inspiring bark: all allies ATK +25% for 2 rounds.' }
    },
    panda: {
      attack:  { name: 'Bamboo Slam', cat: 'attack', power: 50, acc: 95, desc: 'A thunderous bamboo-stalk smash.' },
      defense: { name: 'Roly-Poly Roll', cat: 'defense', block: true, healOnBlock: 10, desc: 'Full block; the tumble is oddly restful (heal 10 on block).' },
      special: { name: 'Zen Snack', cat: 'special', heal: 30, buffSelf: { stat: 'def', pct: 25, turns: 2 }, cd: 2, desc: 'Heal self 30 and harden resolve: DEF +25% for 2 rounds.' }
    },
    monkey: {
      attack:  { name: 'Barrel Swing', cat: 'attack', power: 55, acc: 90, desc: 'A wild swinging haymaker.' },
      defense: { name: 'Canopy Dodge', cat: 'defense', evade: 75, counterOnEvade: 8, desc: '75% evade; flings a coconut (8 damage) on dodge.' },
      special: { name: 'Banana Peel', cat: 'special', power: 20, acc: 100, debuff: { stat: 'spd', pct: -40, turns: 2 }, cd: 1, desc: 'The boss slips: SPD -40% for 2 rounds.' }
    },
    deer: {
      attack:  { name: 'Antler Ram', cat: 'attack', power: 50, acc: 95, desc: 'A charging antler thrust.' },
      defense: { name: 'Graceful Bound', cat: 'defense', evade: 75, healOnEvade: 8, desc: '75% evade; a serene leap that mends 8 HP on dodge.' },
      special: { name: 'Forest Blessing', cat: 'special', healAll: 15, cd: 1, desc: 'Gentle woodland light: heal all deployed allies 15.' }
    },
    hedgehog: {
      attack:  { name: 'Spine Jab', cat: 'attack', power: 45, acc: 100, desc: 'A prickly headbutt.' },
      defense: { name: 'Spike Ball', cat: 'defense', block: true, thorns: 12, desc: 'Full block; attackers take 12 thorn damage.' },
      special: { name: 'Quill Volley', cat: 'special', power: 40, acc: 90, cd: 1, desc: 'A piercing spray of quills.' }
    },
    shark: {
      attack:  { name: 'Jaw Crush', cat: 'attack', power: 60, acc: 85, desc: 'Devastating bite force.' },
      defense: { name: 'Rough Hide', cat: 'defense', thorns: 10, desc: 'Halves Attack damage; sandpaper skin deals 10 back.' },
      special: { name: 'Blood Frenzy', cat: 'special', power: 40, acc: 90, lifesteal: 0.5, cd: 1, desc: 'A frenzied bite healing shark for half the damage dealt.' }
    },
    octopus: {
      attack:  { name: 'Tentacle Lash', cat: 'attack', power: 45, acc: 100, desc: 'Eight-armed pummeling.' },
      defense: { name: 'Camo Jet', cat: 'defense', evade: 70, buffOnEvade: { stat: 'atk', pct: 25, turns: 1 }, desc: '70% evade; vanishing sets up +25% ATK next round.' },
      special: { name: 'Ink Cloud', cat: 'special', debuff: { stat: 'acc', flat: -30, turns: 2 }, cd: 2, desc: 'Blinding ink: boss accuracy -30 for 2 rounds.' }
    },
    hamster: {
      attack:  { name: 'Turbo Nibble', cat: 'attack', power: 45, acc: 100, desc: 'Astonishingly fast tiny bites.' },
      defense: { name: 'Wheel Spin', cat: 'defense', evade: 80, desc: '80% evade - pure rodent RPM.' },
      special: { name: 'Snack Stash', cat: 'special', heal: 20, regen: { amount: 10, turns: 2 }, cd: 2, desc: 'Cheek-pouch feast: heal 20 now, 10 at the end of the next 2 rounds.' }
    },
    parrot: {
      attack:  { name: 'Beak Strike', cat: 'attack', power: 45, acc: 100, desc: 'A precise beak jab.' },
      defense: { name: 'Aerial Weave', cat: 'defense', evade: 70, debuffOnEvade: { stat: 'acc', flat: -10, turns: 1 }, desc: '70% evade; a mocking squawk drops boss accuracy 10 on dodge.' },
      special: { name: 'Mocking Echo', cat: 'special', acc: 90, echoLastBossDamage: true, cap: 40, cd: 1, desc: "Repeats the boss's cruelty: damage equal to what the boss dealt last round (max 40)." }
    },
    turtle: {
      attack:  { name: 'Shell Bash', cat: 'attack', power: 35, acc: 100, useStat: 'def', desc: 'Rams with the shell - uses DEF as the attack stat.' },
      defense: { name: 'Shell Fortress', cat: 'defense', block: true, reflectPct: 25, reflectCap: 25, desc: 'Full block; reflects 25% of the blocked damage (max 25).' },
      special: { name: "Elder's Taunt", cat: 'special', taunt: 2, buffSelf: { stat: 'def', pct: 20, turns: 2 }, cd: 2, desc: 'The boss must target turtle for 2 rounds; turtle DEF +20%.' }
    },
    goat: {
      attack:  { name: 'Skull Bash', cat: 'attack', power: 55, acc: 90, desc: 'A hard-headed ram.' },
      defense: { name: 'Stubborn Stance', cat: 'defense', extraReduce: 0.5, counter: 10, debuffImmune: true, desc: 'Takes only 25% from Attacks, counters 10, shrugs off debuffs.' },
      special: { name: 'Avalanche Charge', cat: 'special', chargeTurns: 1, power: 85, acc: 100, cd: 1, desc: 'Paws the ground; next round an unstoppable 85-power charge auto-fires.' }
    },
    spider: {
      attack:  { name: 'Venom Fang', cat: 'attack', power: 50, acc: 95, desc: 'A piercing venomous bite.' },
      defense: { name: 'Web Snare', cat: 'defense', block: true, debuffOnBlock: { stat: 'spd', pct: -20, turns: 1 }, desc: 'Full block; webs the attacker: boss SPD -20% next round.' },
      special: { name: "Widow's Kiss", cat: 'special', power: 30, acc: 95, dot: { dmg: 6, turns: 3 }, cd: 1, desc: 'Damage plus lingering venom (6 a round for 3 rounds).' }
    },
    ladybug: {
      attack:  { name: 'Dot Dash', cat: 'attack', power: 45, acc: 100, desc: 'A darting spotted headbutt.' },
      defense: { name: 'Dome Shell', cat: 'defense', block: true, healOnBlock: 8, desc: 'Full block under the polka-dot dome; heal 8 on block.' },
      special: { name: 'Lucky Charm', cat: 'special', luckBuff: { dmgPct: 20, turns: 2 }, cd: 3, desc: "For 2 rounds, allies' moves cannot miss and deal +20% damage." }
    },
    bee: {
      attack:  { name: 'Sting Strike', cat: 'attack', power: 55, acc: 90, desc: 'A dive-bombing sting.' },
      defense: { name: 'Scatter Swarm', cat: 'defense', evade: 75, desc: '75% evade in a blur of zigzags.' },
      special: { name: 'Royal Sting', cat: 'special', power: 65, acc: 90, recoil: 10, cd: 2, desc: 'An all-or-nothing royal-jelly-fueled sting; bee takes 10 recoil.' }
    },
    crocodile: {
      attack:  { name: 'Death Roll', cat: 'attack', power: 60, acc: 85, desc: 'A bone-crushing spinning bite.' },
      defense: { name: 'Bask in Shallows', cat: 'defense', heal: 12, desc: 'Halves Attack damage and heals 12 either way (cold-blooded patience).' },
      special: { name: 'Ambush Lunge', cat: 'special', power: 50, acc: 85, bonusIfUntouched: 0.5, cd: 1, desc: '+50% damage if crocodile took no damage last round.' }
    },
    dolphin: {
      attack:  { name: 'Tail Slap', cat: 'attack', power: 45, acc: 100, desc: 'A whip-fast fluke strike.' },
      defense: { name: 'Sonar Slip', cat: 'defense', evade: 70, desc: '70% evade - reads the attack coming.' },
      special: { name: 'Pod Rescue', cat: 'special', revivePct: 0.33, oncePerBattle: true, fallbackHealAll: 10, cd: 2, desc: 'Revives one fainted animal in ANY party at 33% HP (once per battle); otherwise heals all allies 10.' }
    },
    rabbit: {
      attack:  { name: 'Thumper Kick', cat: 'attack', power: 45, acc: 100, desc: 'A spring-loaded double kick.' },
      defense: { name: 'Burrow Hop', cat: 'defense', evade: 80, desc: "80% evade - now you see it, now you don't." },
      special: { name: 'Blur of Feet', cat: 'special', untargetable: 1, cd: 3, desc: 'Moves too fast to hit: rabbit takes NO damage until the end of next round.' }
    },
    dodo: {
      attack:  { name: 'Clumsy Peck', cat: 'attack', power: 45, acc: 95, desc: 'Enthusiastic, mostly aimed pecking.' },
      defense: { name: 'Play Extinct', cat: 'defense', block: true, healOnBlock: 10, desc: "Full block - the boss assumes it's already extinct; heal 10." },
      special: { name: 'Extinction Roulette', cat: 'special', cd: 1, roulette: [
        { chance: 0.25, effect: 'nuke', power: 60, acc: 100, label: 'Comet of Karma' },
        { chance: 0.25, effect: 'healAll', amount: 25, label: 'Second Chance' },
        { chance: 0.25, effect: 'debuff', stat: 'atk', pct: -25, turns: 2, label: 'Existential Dread' },
        { chance: 0.25, effect: 'trip', selfDamage: 5, label: 'Dodo Trips' }
      ], desc: 'History repeats randomly: a 60-power comet, a 25 team heal, boss ATK -25%, or dodo trips.' }
    }
  };

  // === THE 8-BOSS LADDER ===================================================
  // Fixed absolute stats - bosses NEVER scale with player count. Boss moves
  // reuse the same effect vocabulary, plus:
  //   aoe: true            hits every deployed player animal (matchup and
  //                        riders evaluated per target; teamGuard can't help)
  //   randomTargets: true  multi-hit where each hit picks a random target
  //   stealBuff: true      also removes the newest active player buff
  //   telegraph: true      the charge round is openly announced
  //   healingHalve: turns  target's incoming healing halved for N rounds
  //   aoeMode: {...}       Nevermore: may swap its attack for an AoE version
  //                        (power, everyN = at most once per N rounds)
  //   randomDebuffEach     AoE special: each target gets a random debuff
  // twistFx flags (engine-implemented passives):
  //   lifestealAll: f      ALL boss attacks heal it for f * damage
  //   spdDebuffImmune      immune to SPD debuffs
  //   attackDot: {...}     boss attack hits also apply this DoT
  //   enrageAt/enrageAtkPct   below enrageAt fraction of maxHp: ATK +pct%
  //   darkWill: true       incoming debuffs at TUNING.DARK_WILL_FACTOR
  //   alwaysTargetLowest   targeting rule locked to lowest-HP deployed
  //   singleHitCap: n      any single hit taken is capped at n damage
  //   tauntResist: f       (phase 2) taunts fail this fraction of the time
  // ai.profile is implemented in bossAI.js; params ride along here.
  var BOSSES = [
    {
      rung: 1, id: 'darkRaccoon', animal: 'raccoon',
      name: 'Grimebandit', title: 'the Tainted Raccoon',
      stats: { hp: 240, atk: 70, def: 55, spd: 80 },
      moves: {
        attack:  { name: 'Grime Swipe', cat: 'attack', power: 50, acc: 100, desc: 'Filth-caked claws that drink vitality.' },
        defense: { name: 'Trash-Lid Wall', cat: 'defense', block: true, counter: 10, desc: 'A dented shield with a mean clang.' },
        special: { name: 'Filch Flash', cat: 'special', power: 35, acc: 100, stealBuff: true, desc: 'Strikes and pockets the newest ally buff.' }
      },
      twist: 'Pilfer - attacks heal Grimebandit for 25% of damage dealt.',
      twistFx: { lifestealAll: 0.25 },
      ai: { profile: 'SCRAPPER', weights: { attack: 0.5, special: 0.3, defense: 0.2 }, targetRule: 'random' },
      eyes: { l: '37% 47%', r: '63% 47%' },
      restoreLine: 'I took so much... let me give something back. Fight on, friends!'
    },
    {
      rung: 2, id: 'darkGoat', animal: 'goat',
      name: 'Blackhorn', title: 'the Fallen Goat',
      stats: { hp: 340, atk: 90, def: 65, spd: 50 },
      moves: {
        attack:  { name: 'Void Ram', cat: 'attack', power: 55, acc: 90, desc: 'A skull of solid midnight.' },
        defense: { name: 'Obsidian Stance', cat: 'defense', extraReduce: 0.5, counter: 12, desc: 'Planted hooves of black glass.' },
        special: { name: 'Avalanche of Night', cat: 'special', chargeTurns: 1, power: 90, acc: 100, telegraph: true, desc: 'Paws the ground... the mountain itself follows.' }
      },
      twist: 'Immovable - immune to SPD debuffs; the Avalanche charge is openly telegraphed.',
      twistFx: { spdDebuffImmune: true },
      ai: { profile: 'PATTERN', loop: ['attack', 'attack', 'charge', 'release'], defendIfHurtPct: 0.20, targetRule: 'random' },
      eyes: { l: '38% 46%', r: '62% 46%' },
      restoreLine: 'My head is finally clear. The summit ahead is steeper - stay stubborn!'
    },
    {
      rung: 3, id: 'darkSpider', animal: 'spider',
      name: 'Vexweaver', title: 'the Nightmare Spider',
      stats: { hp: 400, atk: 100, def: 55, spd: 95 },
      moves: {
        attack:  { name: 'Night Fang', cat: 'attack', power: 50, acc: 95, desc: 'Fangs that leave nightmares behind.' },
        defense: { name: 'Shadow Web', cat: 'defense', block: true, debuffOnBlock: { stat: 'spd', pct: -20, turns: 1 }, desc: 'A web spun from darkness itself.' },
        special: { name: 'Nightmare Silk', cat: 'special', aoe: true, power: 25, acc: 100, dot: { dmg: 4, turns: 2 }, desc: 'Smothering silk that poisons every ally.' }
      },
      twist: 'Venom Everything - its attack hits also poison (4 a round for 2 rounds).',
      twistFx: { attackDot: { dmg: 4, turns: 2 } },
      ai: { profile: 'TRAPPER', bestResponseChance: 0.5, targetRule: 'unpoisoned' },
      eyes: { l: '40% 44%', r: '60% 44%' },
      restoreLine: 'The nightmares are gone... thank you. My webs will shelter, not snare.'
    },
    {
      rung: 4, id: 'darkBear', animal: 'bear',
      name: 'Grimfang', title: 'the Shadow Bear',
      stats: { hp: 520, atk: 110, def: 70, spd: 55 },
      moves: {
        attack:  { name: 'Umbral Maul', cat: 'attack', power: 55, acc: 90, desc: 'A paw wreathed in living shadow.' },
        defense: { name: 'Darkhide', cat: 'defense', block: true, healOnBlock: 20, desc: 'Shadowstuff knits its wounds closed.' },
        special: { name: 'Terrorclaw Roar', cat: 'special', power: 40, acc: 100, debuffAll: { stat: 'atk', pct: -15, turns: 2 }, desc: 'A roar that saps the courage of every ally.' }
      },
      twist: 'Enrage - below 50% HP its eyes blaze and ATK rises 30%.',
      twistFx: { enrageAt: 0.5, enrageAtkPct: 30 },
      ai: { profile: 'REACTIVE', hurtThresholdPct: 0.15, targetRule: 'highestAtk' },
      eyes: { l: '37% 45%', r: '63% 45%' },
      restoreLine: 'You freed me from the dark hunger. Roar on, little heroes!'
    },
    {
      rung: 5, id: 'darkOctopus', animal: 'octopus',
      name: 'Inkwrath', title: 'the Abyssal Octopus',
      stats: { hp: 620, atk: 105, def: 70, spd: 75 },
      moves: {
        attack:  { name: 'Abyss Lash', cat: 'attack', hits: 2, power: 25, acc: 95, desc: 'Two crushing arms from the deep.' },
        defense: { name: 'Ink Jet', cat: 'defense', evade: 65, desc: 'Vanishes into a cloud of black.' },
        special: { name: 'Ink Veil', cat: 'special', aoe: true, power: 20, acc: 100, debuffAll: { stat: 'acc', flat: -25, turns: 1 }, desc: 'A blinding veil over every ally.' }
      },
      twist: 'Dark Will begins (rungs 5-8) - incoming debuffs are halved.',
      twistFx: { darkWill: true },
      ai: { profile: 'FREQUENCY', windowRounds: 6, targetRule: 'lowestTwo' },
      eyes: { l: '36% 46%', r: '64% 46%' },
      restoreLine: 'Eight arms, and every one of them owes you. The abyss lied to us all.'
    },
    {
      rung: 6, id: 'darkShark', animal: 'shark',
      name: 'Bloodtide', title: 'the Ravenous Shark',
      stats: { hp: 700, atk: 130, def: 65, spd: 90 },
      moves: {
        attack:  { name: 'Crimson Maw', cat: 'attack', power: 60, acc: 90, lifesteal: 0.3, desc: 'A bite that drinks deep.' },
        defense: { name: 'Bloodscale', cat: 'defense', thorns: 12, desc: 'Razor scales slick with menace.' },
        special: { name: 'Feeding Frenzy', cat: 'special', hits: 3, power: 25, acc: 90, randomTargets: true, desc: 'Three wild strikes at random allies.' }
      },
      twist: 'Blood Scent - always hunts the lowest-HP deployed animal.',
      twistFx: { darkWill: true, alwaysTargetLowest: true },
      ai: { profile: 'MOMENTUM', pressDamage: 60, punishHeal: 30, targetRule: 'lowestHp' },
      eyes: { l: '36% 42%', r: '64% 42%' },
      restoreLine: 'The blood-song has quieted... I can finally think. Swim strong!'
    },
    {
      rung: 7, id: 'darkCrocodile', animal: 'crocodile',
      name: 'Shadowmaw', title: 'the Corrupted Crocodile',
      stats: { hp: 760, atk: 140, def: 80, spd: 45 },
      moves: {
        attack:  { name: 'Abyssal Death Roll', cat: 'attack', power: 65, acc: 85, desc: 'The ancient roll, blacker than the deep.' },
        defense: { name: 'Basalt Scales', cat: 'defense', block: true, reflectPct: 30, reflectCap: 30, desc: 'Volcanic armor that returns violence.' },
        special: { name: 'Drown in Darkness', cat: 'special', power: 45, acc: 95, healingHalve: 2, desc: 'Drags its prey under; healing is halved for 2 rounds.' }
      },
      twist: 'Ancient Armor - any single hit it takes is capped at 60 damage.',
      twistFx: { darkWill: true, singleHitCap: 60 },
      ai: { profile: 'MARKOV', targetRule: 'topDamager' },
      eyes: { l: '38% 40%', r: '62% 40%' },
      restoreLine: 'Two hundred million years, and no darkness ever gripped me like that. I am in your debt.'
    },
    {
      rung: 8, id: 'darkDodo', animal: 'dodo',
      name: 'Nevermore', title: 'the Undying Dodo',
      stats: { hp: 660, atk: 125, def: 75, spd: 105 },
      phase2: { hp: 330, atk: 140, tauntResist: 0.5, name: 'Extinction Denied' },
      moves: {
        attack:  { name: 'Wing of Ash', cat: 'attack', power: 55, acc: 95, aoeMode: { power: 35, everyN: 2 }, desc: 'Wings that were never meant to fly again.' },
        defense: { name: 'Paradox Feathers', cat: 'defense', evade: 45, healOnEvade: 15, desc: 'It flickers between existing and not.' },
        special: { name: 'Extinction Cry', cat: 'special', aoe: true, power: 30, acc: 100, randomDebuffEach: { options: ['atk', 'spd'], pct: -15, turns: 2 }, desc: 'The cry of a species that refuses to end.' }
      },
      twist: 'Extinction Denied - on first defeat it revives at 400 HP, stronger and wilier. Beat it twice.',
      twistFx: { darkWill: true },
      ai: { profile: 'ENSEMBLE', weights: { frequency: 0.3, markov: 0.5, level2: 0.2 }, phase2BluffRate: 0.2, targetRule: 'smart' },
      eyes: { l: '44% 32%', r: '56% 32%' },
      restoreLine: "You brought me back from worse than extinction. This time, I'm staying!"
    }
  ];

  // Ladder order + rescue-to-unlock roster split.
  var LADDER = BOSSES.map(function (b) { return b.id; });
  var LOCKED_START = BOSSES.map(function (b) { return b.animal; });
  var STARTER_ANIMALS = Object.keys(ANIMALS).filter(function (id) {
    return LOCKED_START.indexOf(id) === -1;
  });

  // === HELPERS =============================================================
  function bossByRung(rung) { return BOSSES[rung - 1] || null; }
  function bossById(id) {
    for (var i = 0; i < BOSSES.length; i++) if (BOSSES[i].id === id) return BOSSES[i];
    return null;
  }

  // Every animal's stats must total STAT_TOTAL; every animal needs 3 moves.
  function validate() {
    var errors = [];
    Object.keys(ANIMALS).forEach(function (id) {
      var a = ANIMALS[id];
      var sum = a.hp + a.atk + a.def + a.spd;
      if (sum !== TUNING.STAT_TOTAL) {
        errors.push(id + ': stat total ' + sum + ' !== ' + TUNING.STAT_TOTAL);
      }
      var m = MOVES[id];
      if (!m || !m.attack || !m.defense || !m.special) {
        errors.push(id + ': missing move set');
      } else {
        if (m.attack.cat !== 'attack' || m.defense.cat !== 'defense' || m.special.cat !== 'special') {
          errors.push(id + ': move category mismatch');
        }
      }
    });
    BOSSES.forEach(function (b) {
      if (!ANIMALS[b.animal]) errors.push(b.id + ': unknown base animal ' + b.animal);
    });
    return errors;
  }

  exports.CATS = CATS;
  exports.MATCHUP = MATCHUP;
  exports.CAT_LABELS = CAT_LABELS;
  exports.CAT_VERBS = CAT_VERBS;
  exports.TUNING = TUNING;
  exports.ANIMALS = ANIMALS;
  exports.MOVES = MOVES;
  exports.BOSSES = BOSSES;
  exports.LADDER = LADDER;
  exports.LOCKED_START = LOCKED_START;
  exports.STARTER_ANIMALS = STARTER_ANIMALS;
  exports.bossByRung = bossByRung;
  exports.bossById = bossById;
  exports.validate = validate;

})(typeof module !== 'undefined' && module.exports ? module.exports : (window.GameData = {}));
