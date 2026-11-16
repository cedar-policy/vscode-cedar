// reports that the schema is incomplete, since User is external
@id("Document-owner")
permit (
  principal is DocApp::User,
  action == DocApp::Action::"view",
  resource is DocApp::Document
)
when { resource.owner == principal };
