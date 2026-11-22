// Single entry point for the data layer: the reactive hook, the repositories,
// and the (storage-agnostic) model helpers/enums. Components import from here
// and never from the backend directly.
export { useLive } from "./useLive.js";
export { useCanEdit } from "./useCanEdit.js";
export { trees, events, photos, zones } from "./repository.js";
export { getSyncStatus, subscribeSyncStatus } from "./sync.js";
export {
  blankTree,
  estimatedAgeMonths,
  EVENT_TYPES,
  SUN_VALUES,
  WATER_VALUES,
  PRUNING_TIMING_VALUES,
  FERTILIZER_TYPE_VALUES,
  DECIDUOUS_VALUES,
  SOIL_PH_VALUES,
  GROWTH_RATE_VALUES,
  CHILL_REQ_VALUES,
  WIND_TOLERANCE_VALUES,
  POLLINATION_VALUES,
} from "./model.js";
