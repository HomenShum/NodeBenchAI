export function mapEntityProfileTypeToTrajectoryType(entityType?: string) {
  switch (entityType) {
    case "company":
      return "startup";
    case "person":
      return "founder";
    case "product":
      return "product";
    default:
      return "startup";
  }
}

export function formatTrajectoryEntityKey(entityKey: string, entityType: string) {
  if (entityKey.includes(":")) return entityKey;
  return `${entityType}:${entityKey}`;
}
