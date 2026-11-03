import { createContext, useContext } from 'react';

/**
 * How tall the floating dock is at the bottom of a phone screen (0 where there is none: tablets use a side rail, and
 * screens outside the tabs have no dock). The dock floats over the pages, so pages leave this much room at the bottom.
 */
export const DockSpace = createContext(0);
export const useDockSpace = () => useContext(DockSpace);
