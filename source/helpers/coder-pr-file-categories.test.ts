import {expect, test} from 'vitest';

import {categorizeCoderFile, parseGitattributes} from './coder-pr-file-categories.js';

// Excerpt of https://github.com/coder/coder/blob/main/.gitattributes
const gitattributes = `
# Generated files
coderd/apidoc/docs.go linguist-generated=true
docs/reference/api/*.md linguist-generated=true
coderd/database/dump.sql linguist-generated=true
coderd/database/queries.sql.go linguist-generated=true
agent/agentcontainers/testdata/devcontainercli/*/*.log linguist-generated=true
provisionerd/proto/*.go linguist-generated=true
provisionerd/proto/version.go linguist-generated=false
*.tfplan.json linguist-generated=true
site/src/api/typesGenerated.ts linguist-generated=true
site/e2e/google/protobuf/timestampGenerated.ts
`;

const rules = parseGitattributes(gitattributes);

test('parseGitattributes', () => {
	expect(rules).toHaveLength(9);
});

test.each(
	[
		['coderd/apidoc/docs.go', 'generated'],
		['docs/reference/api/builds.md', 'generated'],
		['coderd/database/dump.sql', 'generated'],
		['agent/agentcontainers/testdata/devcontainercli/up/log.log', 'generated'],
		['provisionerd/proto/provisionerd.pb.go', 'generated'],
		['provisionerd/proto/version.go', 'backend'], // Linguist-generated=false wins
		['nested/dir/foo.tfplan.json', 'generated'],
		['site/src/api/typesGenerated.ts', 'generated'],
		['site/e2e/google/protobuf/timestampGenerated.ts', 'tests'], // No linguist-generated attribute
		['coderd/workspaces_test.go', 'tests'],
		['coderd/testdata/parameters/groups/main.tf', 'tests'],
		['testutil/duration.go', 'tests'],
		['site/e2e/tests/app.spec.ts', 'tests'],
		['site/src/pages/LoginPage/LoginPage.test.tsx', 'tests'],
		['site/src/pages/LoginPage/LoginPage.stories.tsx', 'tests'],
		['site/src/pages/LoginPage/LoginPage.tsx', 'frontend'],
		['site/package.json', 'frontend'],
		['coderd/workspaces.go', 'backend'],
		['cli/server.go', 'backend'],
		['go.mod', 'backend'],
		['docs/admin/users.md', 'other'],
		['README.md', 'other'],
		['.github/workflows/ci.yaml', 'other'],
		['helm/coder/values.yaml', 'other'],
		['scripts/build_go.sh', 'other'],
	] as const,
)('categorizeCoderFile(%s) -> %s', (path, expected) => {
	expect(categorizeCoderFile(path, rules)).toBe(expected);
});
