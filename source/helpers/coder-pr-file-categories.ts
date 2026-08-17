export type CoderFileCategory = 'generated' | 'tests' | 'backend' | 'frontend' | 'other';

export const coderFileCategories = ['generated', 'tests', 'backend', 'frontend', 'other'] as const;

export type GitattributesRule = {
	regex: RegExp;
	generated: boolean;
};

// Supports the subset of gitattributes syntax used by coder/coder:
// literal paths, `*` globs (which don't cross `/`), and basename patterns
function patternToRegex(pattern: string): RegExp {
	const source = pattern
		.replace(/^\//, '')
		.replaceAll(/[$()+.?[\\\]^{|}]/g, String.raw`\$&`)
		.replaceAll('**', '\u{0}')
		.replaceAll('*', '[^/]*')
		.replaceAll('\u{0}', '.*');
	const anchor = pattern.includes('/') ? '^' : '(^|/)';
	return new RegExp(anchor + source + '$');
}

export function parseGitattributes(contents: string): GitattributesRule[] {
	const rules: GitattributesRule[] = [];
	for (const line of contents.split('\n')) {
		const [pattern, ...attributes] = line.trim().split(/\s+/);
		if (!pattern || pattern.startsWith('#')) {
			continue;
		}

		if (attributes.includes('linguist-generated=true') || attributes.includes('linguist-generated')) {
			rules.push({regex: patternToRegex(pattern), generated: true});
		} else if (attributes.includes('linguist-generated=false') || attributes.includes('-linguist-generated')) {
			rules.push({regex: patternToRegex(pattern), generated: false});
		}
	}

	return rules;
}

// Last matching rule wins, like git
export function isGenerated(path: string, rules: GitattributesRule[]): boolean {
	let generated = false;
	for (const rule of rules) {
		if (rule.regex.test(path)) {
			generated = rule.generated;
		}
	}

	return generated;
}

const testFileRegex = /(?:_test\.go|\.test\.tsx?|\.spec\.tsx?|\.stories\.tsx?)$/;
const testDirectoriesRegex = /(?:^|\/)(?:testdata|testutil|coderdtest|e2e|testHelpers)\//;
const otherRegex = /^(?:docs|\.github|helm|examples|scripts)\/|\.md$|^\./;

export function categorizeCoderFile(path: string, rules: GitattributesRule[]): CoderFileCategory {
	if (isGenerated(path, rules)) {
		return 'generated';
	}

	if (testFileRegex.test(path) || testDirectoriesRegex.test(path)) {
		return 'tests';
	}

	if (path.startsWith('site/')) {
		return 'frontend';
	}

	if (otherRegex.test(path)) {
		return 'other';
	}

	return 'backend';
}
