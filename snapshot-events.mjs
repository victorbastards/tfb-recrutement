#!/usr/bin/env node
/**
 * Journal d'évènements "entrée dans une étape clé" pour le dashboard recrutement.
 *
 * Problème résolu : le dashboard ne voit que l'ÉTAT courant (qui est actuellement
 * dans l'étape). Or Vivier Vidéo Validé et Entretien Boutique sont des étapes de
 * PASSAGE : dès qu'un candidat est validé puis avancé, il quitte l'étape et n'est
 * plus compté. L'API Teamtailor n'expose pas d'historique de changements d'étape
 * exploitable → on le reconstruit nous-mêmes par différence de snapshots quotidiens.
 *
 * Principe : à chaque run (APRÈS build-data qui génère data.js), on lit l'état
 * candidature -> étape, on le compare au snapshot de la veille, et on journalise
 * toute nouvelle ENTRÉE dans une étape clé (Vivier Vidéo Validé, Entretien Boutique,
 * Offre, Recruté). Le journal alimente l'onglet Alertes (compte les entrées, pas
 * l'état instantané). Fiable à partir du 1er run ; l'historique antérieur n'est pas
 * récupérable via l'API.
 *
 * Fichiers (racine du repo) :
 *   - data.js            (entrée)  : window.__TT_DATA__ = {...}
 *   - stage-snapshot.json (état)   : { appId: stageId }  (dernier état connu)
 *   - stage-events.json  (sortie)  : [ {appId,candidateId,jobId,stageKey,stage,at} ]
 *
 * Usage : node snapshot-events.mjs   (dans le workflow, après build-data)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = process.cwd();
const DATA   = path.join(ROOT, 'data.js');
const SNAP   = path.join(ROOT, 'stage-snapshot.json');
const EVENTS = path.join(ROOT, 'stage-events.json');
const MAX_EVENTS = 5000; // garde-fou : on ne conserve que les N derniers évènements

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Étapes clés suivies (par nom normalisé) + "Recruté" via la catégorie hired
const NAMED = {
  'vivier video valide': 'Vivier Vidéo Validé',
  'entretien boutique':  'Entretien Boutique',
  'offre':               'Offre'
};

function loadTT() {
  const raw = fs.readFileSync(DATA, 'utf8');
  const i = raw.indexOf('{');
  const j = raw.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('data.js : objet JSON introuvable');
  return JSON.parse(raw.slice(i, j + 1));
}
function readJSON(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }

const D = loadTT();
const apps = D.applications || [];
const stages = D.stages || [];
const stageById = {}; stages.forEach(s => stageById[s.id] = s);
const now = D.generatedAt || new Date().toISOString();

function targetOf(stageId) {
  const st = stageById[stageId];
  if (!st) return null;
  const nk = norm(st.name);
  if (NAMED[nk]) return { key: nk, label: NAMED[nk] };
  if ((st.category || '') === 'hired') return { key: 'hired', label: 'Recruté' };
  return null;
}

// snapshot courant : appId -> stageId (candidatures non rejetées uniquement)
const cur = {};
for (const a of apps) if (!a.rejectedAt) cur[a.id] = a.stageId;

const prev = readJSON(SNAP, {});
let events = readJSON(EVENTS, []);
const firstRun = Object.keys(prev).length === 0;

let added = 0;
if (!firstRun) {
  for (const a of apps) {
    if (a.rejectedAt) continue;
    if (prev[a.id] === a.stageId) continue;      // pas de changement d'étape
    const t = targetOf(a.stageId);
    if (!t) continue;                            // l'étape d'arrivée n'est pas une étape clé
    events.push({
      appId: a.id, candidateId: a.candidateId, jobId: a.jobId,
      stageKey: t.key, stage: t.label, at: a.changedStageAt || now
    });
    added++;
  }
}

// on borne la taille du journal (les plus récents en priorité)
if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);

fs.writeFileSync(SNAP, JSON.stringify(cur));
fs.writeFileSync(EVENTS, JSON.stringify(events));
console.log(`[stage-events] ${firstRun ? 'snapshot INITIAL (pas de diff)' : 'diff'} : ${added} nouvelle(s) entrée(s) · total journal=${events.length} · snapshot=${Object.keys(cur).length} candidatures`);
