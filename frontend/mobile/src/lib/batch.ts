import { Dimensions } from 'react-native';

/**
 * How many rows of about `rowHeight` points fill the window, plus one (never fewer than 6 or more than 30). The first page of a
 * server-paged list is this big, so the screen opens full instead of half empty with grey rows below.
 */
export const screenBatch = (rowHeight = 90) => Math.min(30, Math.max(6, Math.ceil(Dimensions.get('window').height / rowHeight) + 1));

/** Every page after the first: the server's usual page size. */
export const PAGE_STEP = 20;
