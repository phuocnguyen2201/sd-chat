/*
  Focus styling shared by the text fields on the auth screens.

  gluestack's focused border is `primary-700`, which the theme maps to
  near-black in light and near-white in dark. On a screen whose background does
  not follow the same flag the focused field disappears into it, so the colour
  is stated outright here instead of inherited.
*/
export const inputFocusClassName = [
  'data-[focus=true]:border-blue-500',
  'data-[focus=true]:hover:border-blue-500',
  'data-[focus=true]:web:ring-blue-500',
].join(' ');
