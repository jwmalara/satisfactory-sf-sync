// Parse a Satisfactory .sav and write a small, diff-friendly digest into state/.
// Usage: node scripts/digest.mjs save/latest.sav
import fs from 'node:fs';
import { Parser } from '@etothepii/satisfactory-file-parser';

const file = process.argv[2] ?? 'save/latest.sav';
const OUT = 'state';
fs.mkdirSync(OUT, { recursive: true });

const save = Parser.ParseSave('save', new Uint8Array(fs.readFileSync(file)).buffer);
const objects = Object.values(save.levels).flatMap(l => l.objects);
const h = save.header;

// --- helpers ---------------------------------------------------------------
const short = p => (p ?? '').split(/[.:]/).pop().replace(/_C$/, '');      // ".../Build_SmelterMk1.Build_SmelterMk1_C" -> "Build_SmelterMk1"
const prop = (o, name) => { const p = o.properties?.[name]; return Array.isArray(p) ? p[0] : p; };
const val = (o, name, dflt) => prop(o, name)?.value ?? dflt;
const m = n => Math.round(n / 100);                                        // cm -> m
const pos = o => o.transform?.translation ?? { x: 0, y: 0, z: 0 };
const csv = rows => rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n') + '\n';
const byType = s => objects.filter(o => o.typePath.includes(s));

// --- progression -------------------------------------------------------------
const schematicMgr = byType('BP_SchematicManager')[0];
const purchased = (prop(schematicMgr, 'mPurchasedSchematics')?.values ?? []).map(r => r.pathName);
const group = re => purchased.filter(p => re.test(p)).map(short).sort();
const milestones = group(/\/Progression\/Schematic_\d/).map(s => s.replace('Schematic_', ''));
const alternates = group(/\/Alternate\//).map(s => s.replace(/^Schematic_Alternate_/, ''));
const mam = group(/\/Research\//);
const phase = short(val(byType('GamePhaseManager')[0] ?? {}, 'mCurrentGamePhase')?.pathName);

// --- crash sites -------------------------------------------------------------
const pods = byType('/DropPod/BP_DropPod.').map(o => ({
  id: o.instanceName.split('.').pop(),
  opened: !!val(o, 'mHasBeenOpened', false),
  ...pos(o),
}));
fs.writeFileSync(`${OUT}/crash_sites.csv`, csv([
  ['id', 'opened', 'x_m', 'y_m', 'z_m'],
  ...pods.sort((a, b) => a.id.localeCompare(b.id)).map(p => [p.id, p.opened, m(p.x), m(p.y), m(p.z)]),
]));

// --- machines (producers, extractors, generators) ----------------------------
const isMachine = o => o.transform && (prop(o, 'mCurrentRecipe') ||
  /\/Build_(Miner|WaterPump|OilPump|FrackingSmasher|FrackingExtractor|Generator)/.test(o.typePath));
const machines = objects.filter(isMachine).map(o => {
  const p = pos(o);
  return {
    type: short(o.typePath).replace(/^Build_/, ''),
    recipe: short(val(o, 'mCurrentRecipe')?.pathName ?? val(o, 'mExtractableResource')?.pathName ?? val(o, 'mCurrentFuelClass')?.pathName ?? '').replace(/^(Recipe_|Desc_)/, ''),
    clock: Math.round(val(o, 'mCurrentPotential', 1) * 1000) / 10,
    sloop: val(o, 'mCurrentProductionBoost', 1),
    paused: !!val(o, 'mIsProductionPaused', false),
    x: m(p.x), y: m(p.y), z: m(p.z),
  };
}).sort((a, b) => a.type.localeCompare(b.type) || a.recipe.localeCompare(b.recipe) || a.x - b.x || a.y - b.y);
fs.writeFileSync(`${OUT}/machines.csv`, csv([
  ['type', 'recipe_node_or_fuel', 'clock_pct', 'sloop_boost', 'paused', 'x_m', 'y_m', 'z_m'],
  ...machines.map(r => [r.type, r.recipe, r.clock, r.sloop, r.paused, r.x, r.y, r.z]),
]));

// --- map markers, stations ---------------------------------------------------
const markers = (prop(byType('FGMapManager')[0] ?? {}, 'mMapMarkers')?.values ?? []).map(v => {
  const loc = v.properties?.Location?.value?.properties ?? {};
  return { name: v.properties?.Name?.value ?? '', x: m(loc.X?.value ?? 0), y: m(loc.Y?.value ?? 0), z: m(loc.Z?.value ?? 0) };
});
fs.writeFileSync(`${OUT}/map_markers.csv`, csv([['name', 'x_m', 'y_m', 'z_m'], ...markers.map(k => [k.name, k.x, k.y, k.z])]));
const stations = byType('FGTrainStationIdentifier').map(o => val(o, 'mStationName')?.value).filter(Boolean).sort();

// --- summary -----------------------------------------------------------------
const counts = {};
for (const r of machines) { const k = r.recipe ? `${r.type} (${r.recipe})` : r.type; counts[k] = (counts[k] ?? 0) + 1; }
const typeCounts = {};
for (const r of machines) typeCounts[r.type] = (typeCounts[r.type] ?? 0) + 1;
const saved = /^\d+$/.test(String(h.saveDateTime)) ? new Date(Number(h.saveDateTime)).toISOString() : h.saveDateTime;
const hrs = (h.playDurationSeconds / 3600).toFixed(1);

const md = `# ${h.sessionName}

Save time: ${saved} (file: ${process.env.SAVE_NAME ?? file}) · play time ${hrs} h · save v${h.saveVersion} / build ${h.buildVersion}
Game phase: ${phase || 'unknown'} · machines: ${machines.length} · crash sites opened: ${pods.filter(p => p.opened).length} of ${pods.length}

## Milestones purchased (${milestones.length})
${milestones.join(', ')}

## Alternate recipes (${alternates.length})
${alternates.join(', ') || '-'}

## MAM research (${mam.length})
${mam.join(', ') || '-'}

## Machine counts by type
${Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Machine counts by type and recipe
${Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Train stations (${stations.length})
${stations.join(', ') || '-'}

## Map markers (${markers.length})
${markers.map(k => `- ${k.name} (${k.x}, ${k.y})`).join('\n') || '-'}

Detail: machines.csv (every machine with recipe, clock, position in metres), crash_sites.csv, map_markers.csv.
`;
fs.writeFileSync(`${OUT}/summary.md`, md);
console.log(`digest: ${machines.length} machines, ${pods.length} pods, ${markers.length} markers, ${purchased.length} schematics`);
