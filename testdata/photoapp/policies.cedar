// allow resource.owner full access to Photos
@id("Photo-owner")
permit (
  principal is PhotoApp::User,
  action in
    [PhotoApp::Action::"viewPhoto",
     PhotoApp::Action::"editPhoto",
     PhotoApp::Action::"deletePhoto"],
  resource in PhotoApp::Application::"PhotoApp"
)
when { resource.owner == principal };

// deny access to private Photos from non-owner
@id("Photo-labels-private")
forbid (
  principal is PhotoApp::User,
  action,
  resource in PhotoApp::Application::"PhotoApp"
)
when { resource.labels.contains("private") }
unless { resource.owner == principal };

// allow entity subjects to view Photos
@id("Photo-subjects")
permit (
  principal is PhotoApp::User,
  action == PhotoApp::Action::"viewPhoto",
  resource in PhotoApp::Application::"PhotoApp"
)
when { resource has subjects && resource.subjects.contains(principal) };

// conditionally allow PhotoJudge to view "contest" Photos
@id("PhotoJudge")
permit (
  principal in PhotoApp::Role::"PhotoJudge",
  action == PhotoApp::Action::"viewPhoto",
  resource in PhotoApp::Application::"PhotoApp"
)
when { resource.labels.contains("contest") }
when { context has judgingSession && context.judgingSession == true };

@id("viewPhoto-template")
permit (
  principal in ?principal,
  action == PhotoApp::Action::"viewPhoto",
  resource in ?resource
);
