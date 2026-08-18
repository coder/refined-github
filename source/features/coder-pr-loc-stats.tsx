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
	if (hiddenIds.length === 0) {
		style.textContent = '';
		return;
	}

	// Match only real file-tree rows: an unscoped `li:has(...)` also caught
	// the React view's per-file `li` wrappers, collapsing their diffs and
	// the inline comment composer along with them.
	const treeRows = hiddenIds
		.flatMap(id => [
			// Classic view; the row carries the id itself
			`li#file-tree-item-${id}`,
			// React view; `:not(:has(li))` skips ancestor directory rows
			`li[class*="file-tree-row"]:not(:has(li)):has(a[href="#${id}"])`,
		])
		.join(',\n');
	// `display: none` on the React view's diff containers broke its inline
	// comment composer, so only dim diffs; never remove them from layout.
	const diffs = hiddenIds
		.map(id => `#${id}`)
		.join(',\n');
	style.textContent = `${treeRows} {display: none !important;}\n`
		+ `${diffs} {opacity: 0.3;}`;
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
	// GitHub fires an extra navigation event when `/files` soft-redirects to
	// the React `/changes` view, running `init` again before the first run
	// is aborted and duplicating the panel.
	deduplicate: '.rgh-coder-loc-stats',
	init,
});

/*

Test URLs:

https://github.com/coder/coder/pull/20000/files
Large PR: https://github.com/coder/coder/pull/19998/files

*/
