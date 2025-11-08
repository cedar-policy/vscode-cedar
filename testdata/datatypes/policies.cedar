@id("P1")
permit (
  principal is NS1::User,
  action == NS1::Action::"renameGroup",
  resource is NS1::Group
)
when { principal in resource.owners };

@id("P2")
permit (
  principal is NS1::User,
  action == NS1::Action::"renameUser",
  resource is NS1::User
)
when { principal in [resource, resource.delegate] };
