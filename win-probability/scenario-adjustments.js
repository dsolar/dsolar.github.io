// Retain every modelled field-goal attempt within the bank's 66-yard range.
for (const s of [...window.WP_DATA.scenarios, ...window.WP_DATA.famous]) {
  const i = s.inputs || {};
  if (s.kind === "4th" && s.model === "nfl4th" && i.fgDist <= 66 && [i.fgp, i.wpM, i.wpX].every(Number.isFinite) && !("fg" in s.opts)) {
    s.opts.fg = Math.round((i.fgp / 100 * i.wpM + (1 - i.fgp / 100) * i.wpX) * 10) / 10;
    s.best = Object.keys(s.opts).reduce((a, b) => s.opts[a] >= s.opts[b] ? a : b);
  }
}
