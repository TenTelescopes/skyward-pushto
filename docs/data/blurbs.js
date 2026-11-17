// Friendly names and one-line "what am I looking at" notes for the showpieces.
// Written for first-time observers: what the object is and what to look for in a small telescope.
// Keys are the labels the app shows (M13, Jupiter, Albireo) or the NGC id for objects without a Messier number.
// General-knowledge notes — distances are rounded, commonly quoted values.

/** Names people actually use, where the source catalogue has none or an unusual one. */
export const NAMES = {
  M11: 'Wild Duck Cluster', M13: 'Great Hercules Cluster', M17: 'Omega (Swan) Nebula', M24: 'Sagittarius Star Cloud',
  M42: 'Orion Nebula', M43: "De Mairan's Nebula", M44: 'Beehive Cluster', M45: 'Pleiades', M65: 'Leo Triplet', M66: 'Leo Triplet',
  M74: 'Phantom Galaxy', M76: 'Little Dumbbell Nebula', M87: 'Virgo A', M101: 'Pinwheel Galaxy',
  'NGC 869': 'Double Cluster', 'NGC 884': 'Double Cluster', 'NGC 7662': 'Blue Snowball', 'NGC 3242': 'Ghost of Jupiter', 'NGC 457': 'Owl (E.T.) Cluster',
};

/** Corrected spellings for the bright-star list (ids stay as they are so saved targets keep working). */
export const STAR_NAMES = {
  Merck: 'Merak', Phad: 'Phecda', Scheet: 'Scheat', 'Kocab (Kochab)': 'Kochab', CorCaroli: 'Cor Caroli', Aishain: 'Alshain',
  'Algieba (Algeiba)': 'Algieba', 'Almaak (Almach)': 'Almach', 'Alnath (Elnath)': 'Elnath', 'Shedir (Shedor)': 'Schedar',
  Alphekka: 'Alphecca', Mirphak: 'Mirfak', Adara: 'Adhara',
};

/**
 * Famous doubles from the bright-star list that the RASC double-star file doesn't cover.
 * Approximate, commonly quoted values (separation in arcseconds, position angle in degrees, magnitudes).
 */
export const STAR_PAIRS = {
  Albireo: { c: 'AB', sep: 35, pa: 54, mags: '3.2/4.7' },
  Mizar: { c: 'AB', sep: 14.4, pa: 153, mags: '2.2/3.9' },
  Castor: { c: 'AB', sep: 5.5, pa: 51, mags: '1.9/3.0' },
  Algieba: { c: 'AB', sep: 4.7, pa: 127, mags: '2.4/3.6' },
  Izar: { c: 'AB', sep: 2.9, pa: 343, mags: '2.6/4.8' },
};

/**
 * What kind of double each one is. "Double star" is the umbrella term for stars that look close together.
 *   True binary / True multiple     — bound by gravity, confirmed (an orbit has been measured somewhere in the system)
 *   Likely binary / Likely multiple — same distance and moving together, so probably bound, but not proven
 *   Optical double / Optical multiple — a chance line-up of unrelated stars at different distances
 *   (not listed)                    — shown simply as "Double star"
 * "Binary" is two stars, "multiple" three or more. Only well-established cases are listed, from general knowledge.
 * To do: fill the rest from the Washington Double Star Catalog note codes or Gaia distances and motions.
 * Keys are the labels the app shows. Codes: tb, lb, tm, lm, od, om, and 'unsure' for cases still argued over.
 */
export const DOUBLE_NATURE = {
  // an orbit has been measured
  Castor: 'tm', Algieba: 'tb', Izar: 'tb', '61 Cyg': 'tb', Achird: 'tb', Almaak: 'tm', Almach: 'tm', 'Xi Sco': 'tm', Tegmen: 'tm',
  'Sigma CrB': 'tb', 'Gamma 2 Del': 'tb', Rasalgethi: 'tb', Mizar: 'tm', 'Epsilon 1 Lyr': 'tm', Polaris: 'tm', Keid: 'tm', Alkalurops: 'tm',
  // travelling together at the same distance; too wide and slow to watch orbiting
  'Cor Caroli': 'lb', Mesarthim: 'lb', Kuma: 'lb', 'Theta 1 Ser': 'lb', 'Beta Mon': 'lm', Trapezium: 'lm',
  Albireo: 'unsure',
  // a chance line-up: the two stars lie at very different distances
  M40: 'od', 'Winnecke 4': 'od',
};
export const NATURE_LABEL = { tb: 'True binary', lb: 'Likely binary', tm: 'True multiple', lm: 'Likely multiple', od: 'Optical double', om: 'Optical multiple', unsure: 'Double star', unknown: 'Double star' };
export const NATURE_NOTE = {
  tb: 'True binary: two stars bound by gravity, orbiting each other.',
  lb: 'Likely binary: the two stars are at the same distance and moving together, so they are probably in orbit.',
  tm: 'True multiple: three or more stars bound by gravity. A small telescope usually splits only two of them.',
  lm: 'Likely multiple: three or more stars at the same distance and moving together, so probably bound by gravity.',
  od: 'Optical double: a chance line-up. The two stars are at different distances and are not a pair.',
  om: 'Optical multiple: a chance line-up of unrelated stars at different distances.',
  unsure: 'Double star. Whether these two really orbit each other is still debated.',
  unknown: 'Double star: stars that look close together. The app does not yet know whether they are bound by gravity or a chance line-up.',
};
/** True when the stars are, or probably are, bound by gravity. */
export const isBound = (code) => ['tb', 'lb', 'tm', 'lm'].includes(code);
/** The code for a double ('tb', 'lb', 'tm', 'lm', 'od', 'om', 'unsure', 'unknown'), or null for anything else. */
export function doubleNature(o) {
  if (!o || !(o.t === 'DS' || ((o.key || '').startsWith('st:') && o.pairs))) return null;
  return DOUBLE_NATURE[o.label] || DOUBLE_NATURE[o.id] || 'unknown';
}

/**
 * Spectral class of each named star (the letter only), for drawing its colour. Keys are catalogue ids.
 * From general knowledge; the faint field stars have no colour data and stay pale.
 */
export const STAR_CLASS = {
  Acamar: 'A', Achernar: 'B', Acrux: 'B', Adara: 'B', Albireo: 'K', Alcor: 'A', Alcyone: 'B', Aldebaran: 'K', Alderamin: 'A', Algenib: 'B',
  'Algieba (Algeiba)': 'K', Algol: 'B', Alhena: 'A', Alioth: 'A', Alkaid: 'B', 'Almaak (Almach)': 'K', Alnair: 'B', 'Alnath (Elnath)': 'B', Alnilam: 'B',
  Alnitak: 'O', Alphard: 'K', Alphekka: 'A', Alpheratz: 'B', Aishain: 'G', Altair: 'A', Ankaa: 'K', Antares: 'M', Arcturus: 'K', Arneb: 'F',
  Bellatrix: 'B', Betelgeuse: 'M', Canopus: 'F', Capella: 'G', Castor: 'A', CorCaroli: 'A', Deneb: 'A', Denebola: 'A', Diphda: 'K', Dubhe: 'K',
  Enif: 'K', Etamin: 'K', Fomalhaut: 'A', Hadar: 'B', Hamal: 'K', Izar: 'K', 'Kaus Australis': 'B', 'Kocab (Kochab)': 'K', Markab: 'A', Megrez: 'A',
  Menkar: 'M', Merck: 'A', Mintaka: 'O', Mira: 'M', Mirach: 'M', Mirphak: 'F', Mizar: 'A', Nihal: 'G', Nunki: 'B', Phad: 'A', Polaris: 'F',
  Pollux: 'K', Procyon: 'F', Rasalgethi: 'M', Rasalhague: 'A', Regulus: 'B', Rigel: 'B', Sadalmelik: 'G', Saiph: 'B', Scheet: 'M', Shaula: 'B',
  'Shedir (Shedor)': 'K', Sirius: 'A', Spica: 'B', Tarazed: 'K', Thuban: 'A', Unukalhai: 'K', Vega: 'A', Vindemiatrix: 'G',
};
/** Colours of the two stars of some famous doubles (brighter first), by the label the app shows. */
export const PAIR_CLASS = {
  Albireo: 'KB', Almach: 'KB', Almaak: 'KB', Izar: 'KA', Rasalgethi: 'MG', 'Cor Caroli': 'AF', Mizar: 'AA', Castor: 'AA', Algieba: 'KG',
  '61 Cyg': 'KK', Achird: 'GM', Mesarthim: 'AA', Polaris: 'FF', M40: 'GF', 'Winnecke 4': 'GF',
};

export const BLURBS = {
  // ---- Solar system
  Moon: 'Craters, mountains and dark lava plains in sharp relief. The best views are along the line between light and shadow, not at full Moon.',
  Mercury: 'Small and never far from the Sun — catch it low in twilight. It shows phases like a tiny Moon.',
  Venus: 'Dazzling and featureless, but it goes through phases like the Moon: a small disc, a half, or a large thin crescent.',
  Mars: 'A small orange disc. Around its closest approaches, every two years or so, you can pick out a white polar cap and dark markings.',
  Jupiter: 'Two dark cloud belts and four moons strung out in a line. The moons change position from night to night.',
  Saturn: 'The rings — visible even at low power. Look for Titan, its largest moon, as a star-like point nearby.',
  Uranus: 'A tiny pale blue-green disc. At high power it clearly is not a star.',
  Neptune: 'A very small blue dot. It takes high power to tell it from a star.',

  // ---- Messier showpieces
  M1: 'The wreck of a star that was seen to explode in the year 1054. A faint oval glow.',
  M2: 'A rich, compact globular cluster — a bright fuzzy ball that turns grainy at higher power.',
  M3: 'One of the finest globular clusters, with roughly half a million stars.',
  M4: 'A loose globular cluster beside Antares, and one of the closest to us.',
  M5: 'A bright, slightly oval globular cluster that rivals M13.',
  M6: 'An open cluster whose stars sketch the outline of a butterfly.',
  M7: 'A big, bright cluster known since antiquity. Use your lowest power.',
  M8: 'A glowing gas cloud with a star cluster inside it; a dark lane cuts across the middle.',
  M10: 'A bright globular cluster in Ophiuchus. M12 is a few degrees away — compare the two.',
  M11: 'One of the richest open clusters: a dense swarm of faint stars with one brighter star near the middle.',
  M12: 'A loose globular cluster in Ophiuchus, a few degrees from M10.',
  M13: 'The showpiece globular cluster of the northern sky: several hundred thousand stars about 22,000 light-years away. Higher power starts to break its edges into stars.',
  M15: 'A bright globular cluster with a very dense, almost star-like core.',
  M16: 'A star cluster wrapped in faint nebula — home of the famous "Pillars of Creation", though those need a photograph.',
  M17: 'A bright bar of nebula shaped like a swan, or a tick mark.',
  M20: 'A nebula split into three by dark lanes. Faint — it needs a dark sky.',
  M22: 'A big, bright globular cluster in Sagittarius — easier to resolve than M13, but low from northern sites.',
  M24: 'A bright patch of the Milky Way itself, packed with stars. Use your lowest power.',
  M27: 'A large, bright planetary nebula — the glowing shell of a dying star, shaped like an apple core.',
  M29: 'A small cluster of a few bright stars in the middle of Cygnus.',
  M31: 'The nearest large galaxy, about 2.5 million light-years away. You see its bright core; the full disc is several Moon-widths across.',
  M32: 'A small, bright companion of the Andromeda Galaxy — a fuzzy star just beside its core.',
  M33: 'A big face-on spiral galaxy with its light spread thin. It needs a dark sky and low power.',
  M34: 'A loose, bright cluster in Perseus — good at low power.',
  M35: 'A large, rich cluster at the foot of Gemini. A much fainter, more distant cluster (NGC 2158) sits beside it.',
  M36: 'A compact, bright cluster — one of three Messier clusters in Auriga.',
  M37: 'The richest of the three Auriga clusters: a fine dusting of faint stars.',
  M38: 'A loose cluster in Auriga whose brighter stars form a cross.',
  M39: 'A sparse cluster of a few dozen bright stars. Best at low power.',
  M41: 'A bright cluster a little below Sirius.',
  M42: 'The best nebula in the sky: a glowing cloud where stars are forming, about 1,300 light-years away. At its heart is the Trapezium, four tight stars.',
  M43: 'A small comma of nebula attached to the Orion Nebula.',
  M44: 'A big, bright cluster you can see with the naked eye from a dark site. Use your lowest power.',
  M45: 'The Seven Sisters: a young, nearby cluster of blue-white stars. It overflows a high-power field — use your lowest power.',
  M46: 'A rich cluster with a tiny planetary nebula (NGC 2438) in front of it.',
  M47: 'A bright, coarse cluster right next to M46.',
  M51: 'Two galaxies pulling on each other. You see two fuzzy cores side by side; the spiral arms need a dark sky.',
  M52: 'A rich, compact cluster in Cassiopeia.',
  M56: 'A small globular cluster between Albireo and the Ring Nebula.',
  M57: 'A tiny smoke ring: gas thrown off by a dying star. Small but bright — use medium to high power.',
  M63: 'A galaxy with a bright core in a soft oval glow.',
  M64: 'A bright galaxy with a dark dust lane beside its core — the "black eye".',
  M65: 'One of the Leo Triplet. M65 and M66 fit together in one low-power view.',
  M66: 'One of the Leo Triplet. M65 and M66 fit together in one low-power view.',
  M67: 'One of the oldest open clusters known — a rich group of faint stars.',
  M71: 'A loose globular cluster in Sagitta that looks more like a rich open cluster.',
  M76: 'A small, faint planetary nebula — one of the harder Messier objects.',
  M77: 'A galaxy with a small, bright, almost star-like core.',
  M78: 'A small reflection nebula in Orion that looks like a faint comet.',
  M80: 'A small, very compact globular cluster.',
  M81: 'A bright spiral galaxy about 12 million light-years away. M82 shares the same low-power view.',
  M82: 'An edge-on galaxy: a bright streak right next to M81.',
  M92: 'A fine globular cluster, overlooked because M13 is nearby.',
  M97: 'A large, faint planetary nebula — a round, ghostly disc.',
  M101: 'A big face-on spiral with its light spread thin — a real challenge away from dark skies.',
  M103: 'A small, fan-shaped cluster in Cassiopeia.',
  M104: 'An edge-on galaxy with a bright central bulge and a dark dust lane.',
  M110: 'The larger, fainter companion of the Andromeda Galaxy.',

  // ---- Other favourites (by NGC number)
  'NGC 869': 'Half of the Double Cluster: two rich clusters side by side, one of the best low-power views in the sky.',
  'NGC 884': 'Half of the Double Cluster: two rich clusters side by side, one of the best low-power views in the sky.',
  'NGC 457': 'Two bright "eyes" and outstretched arms of stars — an owl, or E.T.',
  'NGC 7662': 'A small, bright, bluish planetary nebula. Try high power.',
  'NGC 6543': 'A small, bright planetary nebula in Draco.',
  'NGC 6826': 'Look straight at it and the nebula fades; look to one side and it comes back.',
  'NGC 7009': 'A small, bright planetary nebula with a slightly stretched shape.',
  'NGC 3242': 'A bright planetary nebula about the apparent size of Jupiter.',
  'NGC 2392': 'A small, bright planetary nebula with a star at its centre.',

  // ---- Stars and doubles
  Albireo: 'A gold and blue double star — the best colour contrast in the sky. It splits at low power.',
  Mizar: 'With Alcor it makes a naked-eye pair; the telescope splits Mizar itself into two stars.',
  Alcor: 'The fainter naked-eye companion of Mizar in the handle of the Big Dipper.',
  Polaris: 'The North Star. A telescope shows one faint companion beside it; a second, far closer one was only seen with the Hubble Space Telescope.',
  Castor: 'A tight pair of bright white stars. It needs high power.',
  Almach: 'A gold and blue-green double star, like a tighter Albireo.',
  Rigel: 'A brilliant blue-white star with a faint companion very close by.',
  Betelgeuse: 'A red supergiant — notice its orange colour next to blue-white Rigel.',
  Antares: 'A red supergiant, the heart of the Scorpion.',
  Sirius: 'The brightest star in the night sky.',
  Vega: 'A brilliant blue-white star, one corner of the Summer Triangle.',
  Arcturus: 'A bright orange giant — follow the curve of the Big Dipper\'s handle to find it.',
  Capella: 'A bright yellow star high in the winter sky.',
  Algieba: 'A fine pair of golden stars. It needs medium to high power.',
  'Cor Caroli': 'An easy, wide double star below the handle of the Big Dipper.',
  Izar: 'A close orange and blue-white pair. A good test at high power.',
  Rasalgethi: 'A close orange and greenish pair.',
  Mira: 'A red giant that swells and fades over about eleven months — sometimes easy to see, sometimes invisible to the naked eye.',
  Algol: 'The "Demon Star": every few days a companion passes in front and it dims for a few hours.',
  Trapezium: 'Four tight stars at the heart of the Orion Nebula.',
};

/** Blurb for an object from the app's unified list, or null. */
export function blurbFor(o) {
  if (!o) return null;
  return BLURBS[o.label] || BLURBS[o.id] || null;
}
