// https://github.com/cedar-policy/rfcs/blob/main/text/0082-entity-tags.md
permit (
  principal is User,
  action == Action::"writeDoc",
  resource is Document
)
when
{
  resource.owner == principal ||
  (principal.jobLevel > 6 &&
   resource.hasTag("write") &&
   principal.hasTag("write") &&
   resource.getTag("write").containsAny(principal.getTag("write")))
};
