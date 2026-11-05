// each policy @id is the expected "principals actions resources" scope

@id("E1,E2 a,a1,a2 R1,R2")
permit (principal, action, resource);

@id("E1 a,a1 R1,R2 is")
permit (principal, action, resource)
when { principal is NS::E1 };

@id("E2 a2 R2 template")
permit (principal == ?principal, action == NS::Action::"a2", resource);

@id("- - - impossible")
permit (principal is NS::E, action, resource);

@id("invalid")
permit (principal, action == NS::Action::"a1", resource)
when { principal.p1 == 1 };
