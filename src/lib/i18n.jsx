import React, { createContext, useCallback, useContext, useState } from "react";

// ---------------------------------------------------------------------------
// Minimal in-house i18n. No dependency; the whole dictionary lives in this
// file and both languages sit next to each other so a missing translation
// is obvious on sight.
//
// Rules for anyone adding a new user-visible string:
//   1. Pick a stable, English key: "treeDetail.pollinationLine".
//   2. Add BOTH `es` and `en` entries at once.
//   3. Read it in components with the `useT()` hook: `t('the.key', { name })`.
//   4. Interpolation uses {placeholder} tokens replaced from the second arg.
// ---------------------------------------------------------------------------

const DEFAULT_LANG = "es";
const STORAGE_KEY = "orchard-log:lang";

const dict = {
  es: {
    // --- App / navigation ---
    "app.title": "OrchardLog",
    "nav.backup": "Respaldo",
    "nav.zones": "Zonas",
    // Button text shows the OTHER language — the target of the switch.
    "nav.switchTo": "EN",

    // --- Common controls ---
    "common.loading": "Cargando…",
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.edit": "Editar",
    "common.delete": "Borrar",
    "common.remove": "Quitar",
    "common.close": "Cerrar",
    "common.dash": "—",
    "common.min": "mín",
    "common.max": "máx",
    "common.days.short": "d",

    // --- Backup panel ---
    "backup.hint": "Tus datos viven sólo en este dispositivo. Exportá seguido y guardá el archivo en un lugar seguro — es toda tu historia.",
    "backup.export": "Exportar respaldo",
    "backup.import": "Importar respaldo",
    "backup.confirmReplace": "¿Reemplazar TODOS los datos actuales con este respaldo? Cancelar = fusionar en su lugar.",
    "backup.restored": "Restaurado.",
    "backup.invalidFile": "Este archivo no es un respaldo de Orchard Log.",
    "backup.invalidStructure": "El respaldo está dañado o tiene un formato inesperado.",

    // --- Zones ---
    "zones.title": "Zonas",
    "zones.hint": "Definí las zonas de tu terraza; después asignás cada árbol a una en su ubicación.",
    "zones.newPlaceholder": "Nueva zona",
    "zones.add": "Agregar",
    "zones.empty": "Todavía no hay zonas.",
    "zones.deleteConfirm": "¿Borrar la zona «{name}»? Los árboles en ella quedarán como «Sin definir».",
    "zones.none": "Sin definir",

    // --- Demo mode ---
    "demo.banner": "Demo — los datos quedan solo en tu navegador, en este dispositivo.",
    "demo.reset": "Reiniciar demo",
    "demo.resetConfirm": "¿Borrar todo y volver a los árboles de ejemplo?",

    // --- Attention panel ---
    "attention.title": "Requiere atención",
    "attention.overdue": "{n}d atrasado",
    "attention.repotDue": "Trasplante pendiente (último {year})",

    // --- Tree list ---
    "treeList.title": "Tus árboles",
    "treeList.addTree": "Agregar árbol",
    "treeList.empty": "Todavía no hay árboles. Agregá el primero — arrancá con la etiqueta de la maceta y un nombre; el resto lo completás con el tiempo.",
    "treeList.unnamed": "Sin nombre",
    "treeList.needsPartner": "Necesita pareja de polinización",
    "treeList.frostTender": "No tolera heladas",
    "treeList.search": "Buscar por nombre o etiqueta…",
    "treeList.sortBy": "Ordenar",
    "treeList.sort.label": "Etiqueta",
    "treeList.sort.name": "Nombre",
    "treeList.sort.newest": "Más nuevos",
    "treeList.onlyNeedsPartner": "Sólo sin pareja",
    "treeList.groupBySpecies": "Por especie",
    "treeList.noSpecies": "Sin especie",
    "treeList.noMatches": "Ningún árbol coincide con los filtros.",
    "treeList.zoneAll": "Todas las zonas",

    // --- Tree detail ---
    "treeDetail.back": "← Todos los árboles",
    "treeDetail.deleteConfirm": "¿Borrar {name} y todo su historial?",
    "treeDetail.deleteConfirmFallback": "este árbol",
    "treeDetail.unknownAge": "edad desconocida",
    "treeDetail.ageYear": "{n}a",
    "treeDetail.ageMonth": "{n}m",
    "treeDetail.ageZero": "0m",
    "treeDetail.onRootstock": "sobre {rootstock}",
    "treeDetail.potLiters": "maceta de {n}L",
    "treeDetail.specTitle": "Referencia",
    "treeDetail.observedTitle": "Observado",
    "treeDetail.sun": "Sol",
    "treeDetail.water": "Riego",
    "treeDetail.minTemp": "Mín °C",
    "treeDetail.maxTemp": "Máx °C",
    "treeDetail.chillHours": "Horas de frío",
    "treeDetail.leafHabit": "Hábito foliar",
    "treeDetail.matureSize": "Tamaño adulto",
    "treeDetail.matureSizeFormat": "{h}m alto × {w}m ancho",
    "treeDetail.soilPh": "pH del suelo",
    "treeDetail.growthRate": "Velocidad de crecimiento",
    "treeDetail.windTolerance": "Tolerancia al viento",
    "treeDetail.fertilizer": "Fertilizante",
    "treeDetail.pruning": "Poda",
    "treeDetail.fruiting": "Fructificación",
    "treeDetail.position": "Ubicación",
    "treeDetail.quirks": "Particularidades",
    "treeDetail.pollinationPrefix": "Polinización: ",
    "treeDetail.pollinationSelf": "autofértil",
    "treeDetail.pollinationPartial": "parcialmente autofértil",
    "treeDetail.pollinationNeeds": "necesita pareja",
    "treeDetail.pairedWith": " — con {name}",
    "treeDetail.noPartnerSet": " — sin pareja asignada",
    "treeDetail.recurringCare": "Cuidados recurrentes",
    "treeDetail.taskEvery": "cada {n}d",
    "treeDetail.taskSummer": " · verano {n}d",
    "treeDetail.taskWinter": " · invierno {n}d",
    "treeDetail.taskLast": " · último {date}",
    "treeDetail.taskNever": " · nunca hecho",
    "treeDetail.taskUntitled": "Sin título",
    "treeDetail.markDoneToday": "Marcar hecho hoy",
    "treeDetail.addToCalendar": "Al calendario",
    "treeDetail.photos": "Fotos",
    "treeDetail.addPhoto": "+ Foto",
    "treeDetail.clinicalHistory": "Historia clínica",
    "treeDetail.notesPlaceholder": "Notas",
    "treeDetail.log": "Registrar",
    "treeDetail.eventDeleteConfirm": "¿Borrar este registro?",
    "treeDetail.photoDeleteConfirm": "¿Borrar esta foto?",
    "treeDetail.harvestTitle": "Cosecha",
    "treeDetail.yieldAmount": "Cantidad",
    "treeDetail.yieldUnit": "Unidad (kg, u.)",

    // --- Tree form ---
    "treeForm.cancel": "← Cancelar",
    "treeForm.save": "Guardar árbol",
    "treeForm.fieldset.identity": "Identidad",
    "treeForm.fieldset.provenance": "Procedencia",
    "treeForm.fieldset.physical": "Físico",
    "treeForm.fieldset.spec": "Referencia — lo que dicen los libros",
    "treeForm.fieldset.observed": "Observado — lo que hace TU árbol acá",
    "treeForm.fieldset.care": "Cuidados recurrentes",

    "treeForm.label": "Etiqueta de maceta",
    "treeForm.labelHint": "Lo que escribís en la maceta, p.ej. 07",
    "treeForm.commonName": "Nombre común",
    "treeForm.otherNames": "Otros nombres comunes",
    "treeForm.otherNamesHint": "Sinónimos — no se muestran en la lista, pero se buscan.",
    "treeForm.addName": "+ Agregar nombre",
    "treeForm.scientificName": "Nombre científico",
    "treeForm.variety": "Variedad / cultivar",

    "treeForm.source": "Origen",
    "treeForm.sourceHint": "vivero, mercado, regalo, semilla, estaca…",
    "treeForm.purchaseDate": "Fecha de compra",
    "treeForm.claimedAge": "Edad declarada al comprar (meses)",
    "treeForm.claimedAgeHint": "Lo que dijo el vendedor. La edad actual se deriva de esto + fecha de compra.",

    "treeForm.potLiters": "Tamaño de maceta (litros)",
    "treeForm.substrate": "Sustrato",
    "treeForm.grafted": "¿Injertado?",
    "treeForm.rootstock": "Portainjerto",
    "treeForm.rootstockHint": "El portainjerto enanizante afecta el tamaño final.",

    "treeForm.sun": "Sol",
    "treeForm.water": "Riego",
    "treeForm.minTemp": "Temperatura mínima (°C)",
    "treeForm.maxTemp": "Temperatura máxima (°C)",
    "treeForm.chillHours": "Horas de frío requeridas",
    "treeForm.chillHoursHint": "Horas bajo ~7°C necesarias para florecer. Frutales de carozo 300-1000; cítricos 0.",
    "treeForm.deciduous": "Caducifolio / perenne",
    "treeForm.matureHeight": "Altura adulta (m)",
    "treeForm.matureSpread": "Ancho adulto (m)",
    "treeForm.soilPh": "pH preferido del suelo",
    "treeForm.growthRate": "Velocidad de crecimiento",
    "treeForm.windTolerance": "Tolerancia al viento",
    "treeForm.fertilizerType": "Tipo de fertilizante",
    "treeForm.fertilizerNotes": "Notas de fertilización",
    "treeForm.fertilizerNotesHint": "Marca, frecuencia, valores NPK…",
    "treeForm.pruningTiming": "Cuándo podar",
    "treeForm.pruningNotes": "Notas de poda",
    "treeForm.pruningNotesHint": "Método, forma, qué eliminar…",
    "treeForm.fruitingSeason": "Época de fructificación",
    "treeForm.fruitingSeasonHint": "Texto libre, p.ej. \"fines de primavera\", \"ene-mar\"",
    "treeForm.pollination": "Polinización",
    "treeForm.pollinationPartner": "Pareja de polinización",
    "treeForm.pollinationPartnerNone": "— sin asignar —",

    "treeForm.positionOnTerrace": "Ubicación",
    "treeForm.observedSun": "Tolerancia al sol observada",
    "treeForm.observedSunNotes": "Notas de sol observado",
    "treeForm.observedSunNotesHint": "p.ej. quemado bajo sol de tarde en enero",
    "treeForm.observedWater": "Riego observado",
    "treeForm.observedWaterNotes": "Notas de riego observado",
    "treeForm.quirks": "Particularidades",

    "treeForm.careHint": "Alimentan la lista de \"Requiere atención\" en la pantalla principal. Los intervalos de verano / invierno son opcionales — si están vacíos, se usa el intervalo por defecto todo el año.",
    "treeForm.taskName": "Tarea (p.ej. chequeo de riego)",
    "treeForm.taskSummerPh": "verano",
    "treeForm.taskWinterPh": "invierno",
    "treeForm.taskDefaultTitle": "Intervalo por defecto (días)",
    "treeForm.taskSummerTitle": "Sobreescritura de verano (días, opcional)",
    "treeForm.taskWinterTitle": "Sobreescritura de invierno (días, opcional)",
    "treeForm.addTask": "+ Agregar tarea",

    // --- Enum labels ---
    "sun.unknown": "Desconocido",
    "sun.full-sun": "Pleno sol (6+ hrs directas)",
    "sun.part-sun": "Sol parcial (4-6 hrs, preferentemente mañana)",
    "sun.part-shade": "Sombra parcial (2-4 hrs directas)",
    "sun.full-shade": "Sombra plena (<2 hrs directas)",

    "water.unknown": "Desconocido",
    "water.low": "Bajo (tolera sequía)",
    "water.moderate": "Moderado",
    "water.high": "Alto (mantener húmedo)",
    "water.very-high": "Muy alto (riego frecuente)",

    "pruning.unknown": "Desconocido",
    "pruning.winter-dormant": "Invierno, en dormancia",
    "pruning.summer-green": "Verano (poda en verde)",
    "pruning.after-fruit": "Después de la cosecha",
    "pruning.not-needed": "No requiere",

    "fertilizer.unknown": "Desconocido",
    "fertilizer.general-npk": "NPK general (balanceado)",
    "fertilizer.high-potash": "Alto potasio (para fruto)",
    "fertilizer.citrus-blend": "Mezcla para cítricos",
    "fertilizer.acid-loving": "Acidófilo (ericáceas)",
    "fertilizer.slow-release": "Sólo liberación lenta",
    "fertilizer.none": "Ninguno",
    "fertilizer.other": "Otro",

    "deciduous.unknown": "Desconocido",
    "deciduous.deciduous": "Caducifolio",
    "deciduous.evergreen": "Perenne",
    "deciduous.semi-deciduous": "Semicaducifolio",

    "soilPh.unknown": "Desconocido",
    "soilPh.acidic": "Ácido (<5.5)",
    "soilPh.slightly-acidic": "Semi ácido (5.5-6.5)",
    "soilPh.neutral": "Neutro (6.5-7.5)",
    "soilPh.alkaline": "Alcalino (>7.5)",

    "growthRate.unknown": "Desconocido",
    "growthRate.slow": "Lento",
    "growthRate.medium": "Medio",
    "growthRate.fast": "Rápido",

    "windTolerance.unknown": "Desconocido",
    "windTolerance.low": "Baja",
    "windTolerance.medium": "Media",
    "windTolerance.high": "Alta",

    "pollination.unknown": "Desconocido",
    "pollination.self": "Autofértil",
    "pollination.partial-self": "Parcialmente autofértil",
    "pollination.needs-partner": "Necesita pareja",

    "eventType.repot": "trasplante",
    "eventType.prune": "poda",
    "eventType.fertilize": "abonado",
    "eventType.pest": "plaga",
    "eventType.treatment": "tratamiento",
    "eventType.flowering": "floración",
    "eventType.fruit-set": "cuajado",
    "eventType.harvest": "cosecha",
    "eventType.problem": "problema",
    "eventType.move": "movimiento",
    "eventType.note": "nota",
  },

  en: {
    // --- App / navigation ---
    "app.title": "OrchardLog",
    "nav.backup": "Backup",
    "nav.zones": "Zones",
    "nav.switchTo": "ES",

    // --- Common controls ---
    "common.loading": "Loading…",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.remove": "Remove",
    "common.close": "Close",
    "common.dash": "—",
    "common.min": "min",
    "common.max": "max",
    "common.days.short": "d",

    // --- Backup panel ---
    "backup.hint": "Your data lives only on this device. Export regularly and keep the file somewhere safe — it's your whole history.",
    "backup.export": "Export backup",
    "backup.import": "Import backup",
    "backup.confirmReplace": "Replace ALL current data with this backup? Cancel = merge instead.",
    "backup.restored": "Restored.",
    "backup.invalidFile": "This file is not an Orchard Log backup.",
    "backup.invalidStructure": "This backup is corrupted or has an unexpected format.",

    // --- Zones ---
    "zones.title": "Zones",
    "zones.hint": "Define your terrace's zones; then assign each tree to one as its location.",
    "zones.newPlaceholder": "New zone",
    "zones.add": "Add",
    "zones.empty": "No zones yet.",
    "zones.deleteConfirm": "Delete the zone “{name}”? Trees in it become “Undefined”.",
    "zones.none": "Undefined",

    // --- Demo mode ---
    "demo.banner": "Demo — your data stays only in your browser, on this device.",
    "demo.reset": "Reset demo",
    "demo.resetConfirm": "Erase everything and restore the sample trees?",

    // --- Attention panel ---
    "attention.title": "Needs attention",
    "attention.overdue": "{n}d overdue",
    "attention.repotDue": "Repot due (last {year})",

    // --- Tree list ---
    "treeList.title": "Your trees",
    "treeList.addTree": "Add tree",
    "treeList.empty": "No trees yet. Add your first one — start with just a pot label and a name, fill the rest in over time.",
    "treeList.unnamed": "Unnamed",
    "treeList.needsPartner": "Needs a pollination partner",
    "treeList.frostTender": "Frost-sensitive",
    "treeList.search": "Search by name or label…",
    "treeList.sortBy": "Sort",
    "treeList.sort.label": "Pot label",
    "treeList.sort.name": "Name",
    "treeList.sort.newest": "Newest",
    "treeList.onlyNeedsPartner": "Needs partner only",
    "treeList.groupBySpecies": "By species",
    "treeList.noSpecies": "No species",
    "treeList.noMatches": "No trees match the filters.",
    "treeList.zoneAll": "All zones",

    // --- Tree detail ---
    "treeDetail.back": "← All trees",
    "treeDetail.deleteConfirm": "Delete {name} and all its history?",
    "treeDetail.deleteConfirmFallback": "this tree",
    "treeDetail.unknownAge": "unknown age",
    "treeDetail.ageYear": "{n}y",
    "treeDetail.ageMonth": "{n}mo",
    "treeDetail.ageZero": "0mo",
    "treeDetail.onRootstock": "on {rootstock}",
    "treeDetail.potLiters": "{n}L pot",
    "treeDetail.specTitle": "Spec",
    "treeDetail.observedTitle": "Observed",
    "treeDetail.sun": "Sun",
    "treeDetail.water": "Water",
    "treeDetail.minTemp": "Min °C",
    "treeDetail.maxTemp": "Max °C",
    "treeDetail.chillHours": "Chill hours",
    "treeDetail.leafHabit": "Leaf habit",
    "treeDetail.matureSize": "Mature size",
    "treeDetail.matureSizeFormat": "{h}m H × {w}m W",
    "treeDetail.soilPh": "Soil pH",
    "treeDetail.growthRate": "Growth rate",
    "treeDetail.windTolerance": "Wind tolerance",
    "treeDetail.fertilizer": "Fertilizer",
    "treeDetail.pruning": "Pruning",
    "treeDetail.fruiting": "Fruiting",
    "treeDetail.position": "Location",
    "treeDetail.quirks": "Quirks",
    "treeDetail.pollinationPrefix": "Pollination: ",
    "treeDetail.pollinationSelf": "self-fertile",
    "treeDetail.pollinationPartial": "partially self-fertile",
    "treeDetail.pollinationNeeds": "needs a partner",
    "treeDetail.pairedWith": " — paired with {name}",
    "treeDetail.noPartnerSet": " — no partner set",
    "treeDetail.recurringCare": "Recurring care",
    "treeDetail.taskEvery": "every {n}d",
    "treeDetail.taskSummer": " · summer {n}d",
    "treeDetail.taskWinter": " · winter {n}d",
    "treeDetail.taskLast": " · last {date}",
    "treeDetail.taskNever": " · never done",
    "treeDetail.taskUntitled": "Untitled",
    "treeDetail.markDoneToday": "Mark done today",
    "treeDetail.addToCalendar": "Add to calendar",
    "treeDetail.photos": "Photos",
    "treeDetail.addPhoto": "+ Photo",
    "treeDetail.clinicalHistory": "Clinical history",
    "treeDetail.notesPlaceholder": "Notes",
    "treeDetail.log": "Log",
    "treeDetail.eventDeleteConfirm": "Delete this entry?",
    "treeDetail.photoDeleteConfirm": "Delete this photo?",
    "treeDetail.harvestTitle": "Harvest",
    "treeDetail.yieldAmount": "Amount",
    "treeDetail.yieldUnit": "Unit (kg, pcs)",

    // --- Tree form ---
    "treeForm.cancel": "← Cancel",
    "treeForm.save": "Save tree",
    "treeForm.fieldset.identity": "Identity",
    "treeForm.fieldset.provenance": "Provenance",
    "treeForm.fieldset.physical": "Physical",
    "treeForm.fieldset.spec": "Spec — what references say",
    "treeForm.fieldset.observed": "Observed — what YOUR tree does here",
    "treeForm.fieldset.care": "Recurring care",

    "treeForm.label": "Pot label",
    "treeForm.labelHint": "What you write on the pot, e.g. 07",
    "treeForm.commonName": "Common name",
    "treeForm.otherNames": "Other common names",
    "treeForm.otherNamesHint": "Synonyms — hidden in the list, but searchable.",
    "treeForm.addName": "+ Add name",
    "treeForm.scientificName": "Scientific name",
    "treeForm.variety": "Variety / cultivar",

    "treeForm.source": "Source",
    "treeForm.sourceHint": "nursery, market, gift, seed, cutting…",
    "treeForm.purchaseDate": "Purchase date",
    "treeForm.claimedAge": "Claimed age at purchase (months)",
    "treeForm.claimedAgeHint": "What the seller said. Current age is derived from this + purchase date.",

    "treeForm.potLiters": "Pot size (litres)",
    "treeForm.substrate": "Substrate",
    "treeForm.grafted": "Grafted?",
    "treeForm.rootstock": "Rootstock",
    "treeForm.rootstockHint": "Dwarfing rootstock affects final size.",

    "treeForm.sun": "Sun",
    "treeForm.water": "Water",
    "treeForm.minTemp": "Min temperature (°C)",
    "treeForm.maxTemp": "Max temperature (°C)",
    "treeForm.chillHours": "Chill hours needed",
    "treeForm.chillHoursHint": "Hours under ~7°C required for flowering. Stone fruit 300-1000; citrus 0.",
    "treeForm.deciduous": "Deciduous / evergreen",
    "treeForm.matureHeight": "Mature height (m)",
    "treeForm.matureSpread": "Mature spread (m)",
    "treeForm.soilPh": "Soil pH preference",
    "treeForm.growthRate": "Growth rate",
    "treeForm.windTolerance": "Wind tolerance",
    "treeForm.fertilizerType": "Fertilizer type",
    "treeForm.fertilizerNotes": "Fertilizer notes",
    "treeForm.fertilizerNotesHint": "Brand, frequency, NPK numbers…",
    "treeForm.pruningTiming": "Pruning timing",
    "treeForm.pruningNotes": "Pruning notes",
    "treeForm.pruningNotesHint": "Method, shape, what to remove…",
    "treeForm.fruitingSeason": "Fruiting season",
    "treeForm.fruitingSeasonHint": "Free text, e.g. \"late spring\", \"Jan-Mar\"",
    "treeForm.pollination": "Pollination",
    "treeForm.pollinationPartner": "Pollination partner",
    "treeForm.pollinationPartnerNone": "— none set —",

    "treeForm.positionOnTerrace": "Location",
    "treeForm.observedSun": "Observed sun tolerance",
    "treeForm.observedSunNotes": "Observed sun — notes",
    "treeForm.observedSunNotesHint": "e.g. scorched in January afternoon sun",
    "treeForm.observedWater": "Observed watering",
    "treeForm.observedWaterNotes": "Observed watering — notes",
    "treeForm.quirks": "Quirks",

    "treeForm.careHint": "These feed the \"Needs attention\" list on the home screen. Summer / winter intervals are optional — if empty, the default interval is used year-round.",
    "treeForm.taskName": "Task (e.g. water check)",
    "treeForm.taskSummerPh": "summer",
    "treeForm.taskWinterPh": "winter",
    "treeForm.taskDefaultTitle": "Default interval (days)",
    "treeForm.taskSummerTitle": "Summer override (days, optional)",
    "treeForm.taskWinterTitle": "Winter override (days, optional)",
    "treeForm.addTask": "+ Add task",

    // --- Enum labels ---
    "sun.unknown": "Unknown",
    "sun.full-sun": "Full sun (6+ hrs direct)",
    "sun.part-sun": "Part sun (4-6 hrs, morning-leaning)",
    "sun.part-shade": "Part shade (2-4 hrs direct)",
    "sun.full-shade": "Full shade (<2 hrs direct)",

    "water.unknown": "Unknown",
    "water.low": "Low (drought-tolerant)",
    "water.moderate": "Moderate",
    "water.high": "High (evenly moist)",
    "water.very-high": "Very high (frequent watering)",

    "pruning.unknown": "Unknown",
    "pruning.winter-dormant": "Winter, dormant",
    "pruning.summer-green": "Summer (green pruning)",
    "pruning.after-fruit": "After fruit harvest",
    "pruning.not-needed": "Not needed",

    "fertilizer.unknown": "Unknown",
    "fertilizer.general-npk": "General NPK (balanced)",
    "fertilizer.high-potash": "High potash (fruit-focused)",
    "fertilizer.citrus-blend": "Citrus blend",
    "fertilizer.acid-loving": "Acid-loving (ericaceous)",
    "fertilizer.slow-release": "Slow-release only",
    "fertilizer.none": "None",
    "fertilizer.other": "Other",

    "deciduous.unknown": "Unknown",
    "deciduous.deciduous": "Deciduous",
    "deciduous.evergreen": "Evergreen",
    "deciduous.semi-deciduous": "Semi-deciduous",

    "soilPh.unknown": "Unknown",
    "soilPh.acidic": "Acidic (<5.5)",
    "soilPh.slightly-acidic": "Slightly acidic (5.5-6.5)",
    "soilPh.neutral": "Neutral (6.5-7.5)",
    "soilPh.alkaline": "Alkaline (>7.5)",

    "growthRate.unknown": "Unknown",
    "growthRate.slow": "Slow",
    "growthRate.medium": "Medium",
    "growthRate.fast": "Fast",

    "windTolerance.unknown": "Unknown",
    "windTolerance.low": "Low",
    "windTolerance.medium": "Medium",
    "windTolerance.high": "High",

    "pollination.unknown": "Unknown",
    "pollination.self": "Self-fertile",
    "pollination.partial-self": "Partially self-fertile",
    "pollination.needs-partner": "Needs a partner",

    "eventType.repot": "repot",
    "eventType.prune": "prune",
    "eventType.fertilize": "fertilize",
    "eventType.pest": "pest",
    "eventType.treatment": "treatment",
    "eventType.flowering": "flowering",
    "eventType.fruit-set": "fruit-set",
    "eventType.harvest": "harvest",
    "eventType.problem": "problem",
    "eventType.move": "move",
    "eventType.note": "note",
  },
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const stored = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    return stored === "en" || stored === "es" ? stored : DEFAULT_LANG;
  });

  const t = useCallback(
    (key, params) => {
      const template = dict[lang]?.[key] ?? dict.en[key] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
        template
      );
    },
    [lang]
  );

  const setLang = useCallback((l) => {
    if (l !== "es" && l !== "en") return;
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
    document.documentElement.lang = l;
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === "es" ? "en" : "es");
  }, [lang, setLang]);

  return (
    <I18nContext.Provider value={{ lang, t, setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}
