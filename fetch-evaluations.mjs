#!/usr/bin/env node
/**
 * Récupère les évaluations Teamtailor (interviews / scorecards) et écrit evaluations.json.
 *
 * Contexte : à l'étape "Entretien Boutique" il n'y a qu'un seul kit ("Kit entretien B1").
 * Donc toute interview au statut "published" = ce kit rempli. On journalise :
 *   { candidateId, jobId, userId, userName, at, status }
 * pour alimenter la section "Évaluations" de l'onglet Alertes (date, candidat, qui a rempli).
 *
 * Secrets attendus (déjà utilisés par le refresh) : TEAMTAILOR_API_KEY,
 * éventuellement TEAMTAILOR_STACK (eu/na) et TEAMTAILOR_API_VERSION.
 * Écrit à la racine : evaluations.json
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY   = process.env.TEAMTAILOR_API_KEY;
const VER   = process.env.TEAMTAILOR_API_VERSION || '20240904';
const STACK = (process.env.TEAMTAILOR_STACK || 'eu').toLowerCase();
const BASE  = STACK === 'na' ? 'https://api.na.teamtailor.com/v1' : 'https://api.teamtailor.com/v1';
const OUT   = path.join(process.cwd(), 'evaluations.json');

if (!KEY) { console.error('ERREUR: TEAMTAILOR_API_KEY manquant'); process.exit(1); }
const H = { 'Authorization': 'Token token=' + KEY, 'X-Api-Version': VER, 'Accept': 'application/vnd.api+json' };

async function getPage(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers: H });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 2500)); continue; } // rate limit -> retry
    if (!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + url + ' : ' + (await r.text()).slice(0, 300));
    return r.json();
  }
  throw new Error('Trop de 429 sur ' + url);
}

// Récupère toutes les pages d'interviews avec candidate + user + job inclus
const usersById = {};   // userId -> nom lisible
const evaluations = [];
let url = BASE + '/interviews?include=user,candidate,job&page[size]=30&sort=-updated-at';
let pages = 0;

while (url) {
  const j = await getPage(url);
  // indexer les users inclus (nom de l'évaluateur)
  for (const inc of (j.included || [])) {
    if (inc.type === 'users') {
      const a = inc.attributes || {};
      usersById[inc.id] = a.name || [a['first-name'], a['last-name']].filter(Boolean).join(' ') || a.email || a['login-email'] || ('#' + inc.id);
    }
  }
  for (const iv of (j.data || [])) {
    const at = iv.attributes || {};
    if (at.status !== 'published') continue; // on ne garde que les évaluations remplies/soumises
    const rel = iv.relationships || {};
    const candidateId = rel.candidate && rel.candidate.data && rel.candidate.data.id || null;
    const jobId       = rel.job && rel.job.data && rel.job.data.id || null;
    const userId      = rel.user && rel.user.data && rel.user.data.id || null;
    evaluations.push({
      interviewId: iv.id,
      candidateId, jobId, userId,
      userName: userId ? (usersById[userId] || null) : null,
      at: at['updated-at'] || at['created-at'] || null,
      status: at.status
    });
  }
  url = (j.links && j.links.next) || null;
  if (++pages > 200) break; // garde-fou
}

// 2e passe : compléter les userName manquants (user pas toujours inclus selon la page)
for (const e of evaluations) if (e.userId && !e.userName) e.userName = usersById[e.userId] || null;

evaluations.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
fs.writeFileSync(OUT, JSON.stringify(evaluations));

const withUser = evaluations.filter(e => e.userName).length;
console.log(`[evaluations] ${evaluations.length} évaluations "published" écrites · ${withUser} avec évaluateur nommé · ${pages} page(s)`);
if (evaluations[0]) console.log('exemple :', JSON.stringify(evaluations[0]));
