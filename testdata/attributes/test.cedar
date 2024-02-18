permit (principal, action, resource)
when
{
  (principal has some &&
   principal.some has nested &&
   principal.some.nested has attribute &&
   principal.some.nested.attribute == "test") ||
  (principal has "some" &&
   principal["some"] has "nested" &&
   principal["some"]["nested"] has "attribute" &&
   principal["some"]["nested"]["attribute"] == "test") ||
  principal["some"].nested["attribute"] == "test" ||
  (principal.some.nested has "attribute with spaces" &&
   principal.some.nested["attribute with spaces"] == "test") ||
  (principal.some.nested has "attribute:with:colons" &&
   principal.some.nested["attribute:with:colons"] == "test")
};