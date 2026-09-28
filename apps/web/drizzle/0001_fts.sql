-- Full-text index over saves. rowid = saves.seq. Maintained by the application
-- (server/search.ts) because the tags column is denormalised from save_tags.
CREATE VIRTUAL TABLE `saves_fts` USING fts5(
  `title`,
  `description`,
  `url`,
  `tags`,
  `notes`,
  `body`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
