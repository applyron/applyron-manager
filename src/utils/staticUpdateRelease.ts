export interface DarwinStaticReleaseJson {
  version: string;
  url: string;
  name: string;
  notes: string;
  pub_date: string;
}

export function createDarwinStaticReleaseJson({
  version,
  zipFileName,
  publishedAt,
}: {
  version: string;
  zipFileName: string;
  publishedAt: string;
}): DarwinStaticReleaseJson {
  return {
    version,
    url: zipFileName,
    name: version,
    notes: `Update to version ${version}`,
    pub_date: publishedAt,
  };
}
