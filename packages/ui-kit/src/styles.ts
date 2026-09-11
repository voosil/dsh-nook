// The CSS files live at the package root (styles/) instead of src/ because tsc
// does not copy non-TS assets into lib, and consumer bundles resolve this
// package through lib. Sibling-relative imports ('../styles/…') resolve to the
// same files from both src and lib.
import tokens from '../styles/tokens.css'
import components from '../styles/components.css'
import scrollbar from '../styles/scrollbar.css'

export const uiKitStyles = `${tokens}\n${components}\n${scrollbar}`
