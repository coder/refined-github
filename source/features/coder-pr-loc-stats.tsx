import './coder-pr-loc-stats.css';
import {onAbort} from 'abort-utils';
import React from 'dom-chef';
import * as pageDetect from 'github-url-detection';
import {stringToUint8Array, uint8ArrayToHex} from 'uint8array-extras';

import features from '../feature-manager.js';
import api from '../github-helpers/api.js';
import {getConversationNumber, getRepo} from '../github-helpers/index.js';
import {
	categorizeCoderFile,
	coderFileCategories,
	type CoderFileCategory,
	type GitattributesRule,
	parseGitattributes,
} from '../helpers/coder-pr-file-categories.js';

type PrFile = {
	filename: string;
	previous_filename?: string;
	additions: number;
	deletions: number;
};

type CategoryStats = {
	files: number;
	additions: number;
	deletions: number;
	diffIds: string[];
};

const categoryLabels: Record<CoderFileCategory, string> = {
	generated: 'Generated',
	tests: 'Tests',
	backend: 'Backend',
	frontend: 'Frontend',
	other: 'Other',
};

// Survives soft navigation so the filter persists while browsing a PR
const hiddenCategories = new Set<CoderFileCategory>();

function isCoderRepo(): boolean {
	// `getRepo()` is undefined outside of repositories
	return getRepo()?.nameWithOwner === 'coder/coder';
}

// File containers and file-tree links use `diff-<sha256(path)>` anchors in both PR file views
async function pathToDiffId(path: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', stringToUint8Array(path));
	return 'diff-' + uint8ArrayToHex(new Uint8Array(digest));
}

async function fetchGitattributesRules(): Promise<GitattributesRule[]> {
	try {
		const response = await api.v3('contents/.gitattributes', {
			headers: {accept: 'application/vnd.github.raw+json'},
			responseFormat: 'text',
		});
		return parseGitattributes(response.content as string);
	} catch (error) {
		console.warn('coder-pr-loc-stats: could not fetch .gitattributes, "generated" detection disabled', error);
		return [];
	}
}

async function fetchPrFiles(prNumber: number): Promise<PrFile[]> {
	const files: PrFile[] = [];
	for await (const page of api.v3paginated(`pulls/${prNumber}/files?per_page=100`)) {
		files.push(...page as unknown as PrFile[]);
	}

	return files;
}

function updateHiddenFilesStyle(style: HTMLStyleElement, stats: Map<CoderFileCategory, CategoryStats>): void {
	// `hiddenCategories` persists across PRs, so it may name categories absent from this PR
	const hiddenIds = [...hiddenCategories].flatMap(category => stats.get(category)?.diffIds ?? []);
	// Directory tree rows are ancestor `li`s of file rows, so match only the
	// innermost `li` or hiding one file would hide its whole directory.
	// In the React view each file sits in a classless wrapper div that owns its
	// spacing, so also hide the diff's direct parent (never a multi-file
	// container because of the direct-child combinator).
	style.textContent = hiddenIds.length === 0
		? ''
		: hiddenIds
			.flatMap(id => [
				`#${id}`,
				`#diff-content-parent div:has(> #${id})`,
				`li:not(:has(li)):has(a[href="#${id}"])`,
			])
			.join(',\n') + '{display: none !important;}';
}

function buildPanel(stats: Map<CoderFileCategory, CategoryStats>, style: HTMLStyleElement): JSX.Element {
	let totalAdditions = 0;
	let totalDeletions = 0;
	for (const {additions, deletions} of stats.values()) {
		totalAdditions += additions;
		totalDeletions += deletions;
	}

	const rows = coderFileCategories
		.filter(category => stats.has(category))
		.map(category => {
			const {files, additions, deletions} = stats.get(category)!;
			const checkbox = (
				<input
					type="checkbox"
					checked={!hiddenCategories.has(category)}
					onChange={event => {
						if ((event.target as HTMLInputElement).checked) {
							hiddenCategories.delete(category);
						} else {
							hiddenCategories.add(category);
						}

						updateHiddenFilesStyle(style, stats);
					}}
				/>
			);
			return (
				<tr>
					<td><label>{checkbox} {categoryLabels[category]}</label></td>
					<td className="rgh-coder-loc-count">{files}</td>
					<td className="color-fg-success">+{additions.toLocaleString()}</td>
					<td className="color-fg-danger">−{deletions.toLocaleString()}</td>
				</tr>
			);
		});

	return (
		<details open className="rgh-coder-loc-stats">
			<summary>
				<strong>LOC by category</strong>
				{' '}
				<span className="color-fg-success">+{totalAdditions.toLocaleString()}</span>
				{' '}
				<span className="color-fg-danger">−{totalDeletions.toLocaleString()}</span>
			</summary>
			<table>
				<thead>
					<tr>
						<th>Show</th>
						<th>Files</th>
						<th>Added</th>
						<th>Deleted</th>
					</tr>
				</thead>
				<tbody>{rows}</tbody>
			</table>
		</details>
	);
}

async function init(signal: AbortSignal): Promise<false | void> {
	const prNumber = getConversationNumber();
	if (!prNumber) {
		return false;
	}

	const [rules, files] = await Promise.all([
		fetchGitattributesRules(),
		fetchPrFiles(prNumber),
	]);

	if (signal.aborted) {
		return;
	}

	const categorizedFiles = await Promise.all(files.map(async file => ({
		file,
		category: categorizeCoderFile(file.filename, rules),
		// Renamed files may be anchored by either path
		diffIds: await Promise.all(
			[file.filename, file.previous_filename]
				.filter(path => path !== undefined)
				.map(async path => pathToDiffId(path)),
		),
	})));

	const stats = new Map<CoderFileCategory, CategoryStats>();
	for (const {file, category, diffIds} of categorizedFiles) {
		const entry = stats.get(category) ?? {
			files: 0, additions: 0, deletions: 0, diffIds: [],
		};
		entry.files += 1;
		entry.additions += file.additions;
		entry.deletions += file.deletions;
		entry.diffIds.push(...diffIds);
		stats.set(category, entry);
	}

	if (signal.aborted) {
		return;
	}

	const style = document.createElement('style');
	updateHiddenFilesStyle(style, stats);
	const panel = buildPanel(stats, style);
	document.head.append(style);
	document.body.append(panel);
	onAbort(signal, () => {
		style.remove();
		panel.remove();
	});
}

void features.add(import.meta.url, {
	asLongAs: [isCoderRepo],
	include: [pageDetect.isPRFiles],
	exclude: [pageDetect.isPRFile404, pageDetect.isPRCommit],
	init,
});

/*

Test URLs:

https://github.com/coder/coder/pull/20000/files
Large PR: https://github.com/coder/coder/pull/19998/files

*/
