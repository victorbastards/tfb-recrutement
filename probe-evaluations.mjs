#!/usr/bin/env node
/**
 * PROBE (temporaire, LECTURE SEULE) — explore les ressources d'évaluation Teamtailor
 * (Interviews / Scorecard Scores / Scorecard Criteria / Scorecard Picks) pour concevoir
 * l'extraction des scorecards (alerte "Kit entretien B1 rempli"). N'écrit AUCUN fichier :
 * la sortie va dans les logs GitHub Actions. À supprimer une fois le schéma connu.
 *
 * Secrets attendus (déjà présents pour le refresh) : TEAMTAILOR_API_KEY,
 * éventuellement TEAMTAILOR_STACK (eu/na) et TEAMTAILOR_API_VERSION.
 */
const KEY   = process.env.TEAMTAILOR_API_KEY;
const VER   = process.env.TEAMTAILOR_API_VERSION || '20240904';
const STACK = (process.env.TEAMTAILOR_STACK || 'eu').toLowerCase();
const BASE  = STACK === 'na' ? 'https://api.na.teamtailor.com/v1' : 'https://api.teamtailor.com/v1';

if (!KEY) { console.error('ERREUR: TEAMTAILOR_API_KEY manquant'); process.exit(1); }

const H = { 'Authorization': 'Token token=' + KEY, 'X-Api-Version': VER, 'Accept': 'application/vnd.api+json' };

async function get(path) {
  try {
    const r = await fetch(BASE + path, { headers: H });
    const t = await r.text();
    return { status: r.status, body: t };
  } catch (e) { return { status: 0, body: String(e) }; }
}

function summarize(label, r) {
  console.log('\n=================== ' + label + ' ===================');
  console.log('HTTP ' + r.status);
  let j = null;
  try { j = JSON.parse(r.body); } catch { console.log('corps (brut, 1500c):', r.body.slice(0, 1500)); return; }
  const first = (j.data && Array.isArray(j.data)) ? j.data[0] : j.data;
  if (first) {
    console.log('exemple data[0] :');
    console.log(JSON.stringify({
      type: first.type,
      id: first.id,
      attributes: first.attributes,
      relationships: first.relationships ? Object.keys(first.relationships) : null
    }, null, 2));
  } else {
    console.log('data vide. corps (500c):', r.body.slice(0, 500));
  }
  if (j.included) console.log('included types :', [...new Set(j.included.map(x => x.type))]);
  if (j.meta) console.log('meta :', JSON.stringify(j.meta));
}

const ENDPOINTS = [
  ['GET /interviews',        '/interviews?page[size]=2&include=candidate,job,user'],
  ['GET /scorecard-scores',  '/scorecard-scores?page[size]=3&include=interview,user'],
  ['GET /scorecard-criteria','/scorecard-criteria?page[size]=3'],
  ['GET /scorecard-picks',   '/scorecard-picks?page[size]=3'],
];

console.log('Base API :', BASE, '| X-Api-Version :', VER);
for (const [label, ep] of ENDPOINTS) {
  const r = await get(ep);
  summarize(label, r);
}
console.log('\n[probe] terminé.');
