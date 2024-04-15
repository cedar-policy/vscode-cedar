@id("all")
permit (principal, action, resource);

@id("E1,E2 a,a1 R1")
permit (
  principal,
  action,
  resource == NS::R1::"r1"
);

@id("E1 a1 R1")
permit (
  principal in NS::E::"id",
  action == NS::Action::"a1",
  resource
);

@id("E1,E2 a,a1,a2 R1,R2")
permit (
  principal in NS::E::"id",
  action in NS::Action::"as",
  resource in NS::R::"id"
);