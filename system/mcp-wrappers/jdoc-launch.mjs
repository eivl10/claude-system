// Запуск jdocmunch-mcp с урезанным набором тулов (В8 плана оптимизации 03.10.2026).
// Зачем: jdocmunch читает disabled_tools только из переменной JDOCMUNCH_DISABLED_TOOLS, а
// claude_desktop_config.json не передаёт окружение серверу. Остаются 15 тулов из ~66.
import { spawn } from 'node:child_process';

const KEEP = new Set([
  'doc_resolve_repo', 'doc_list_repos', 'index_local', 'search_sections', 'get_section', 'get_sections',
  'get_document_outline', 'get_toc', 'get_toc_tree', 'get_section_context', 'search_titles',
  'verify_index', 'define_repo_group', 'list_repo_groups', 'get_broken_links',
]);

const ALL = `analyze_perf check_embedding_drift check_section_delete_safe count_sections define_repo_group delete_index describe_section diff_doc_health_radar doc_health_radar doc_index_repo doc_list_repos doc_resolve_repo find_code_examples find_endpoint find_operations_using_schema find_similar_sections get_all_roles get_all_tags get_backlinks get_broken_links get_doc get_doc_coverage get_doc_health get_doc_pr_risk_profile get_document_outline get_index_overview get_orphan_sections get_recent_changes get_related_sections get_schema_graph get_section get_section_blast_radius get_section_context get_section_descendants get_section_diff get_section_excerpt get_section_excerpts get_section_path get_section_summaries get_section_summary get_sections get_session_stats get_stale_pages get_toc get_toc_tree get_tutorial_path get_undocumented_symbols get_watch_status get_wiki_stats index_local jdocmunch_guide link_code_to_symbols list_docs list_endpoints_by_tag list_repo_groups list_terms lookup_term resolve_related_code_repos search_sections search_titles section_neighbors tune_weights verify_index finalize_handoff`.split(/\s+/);

const env = { ...process.env };
if (!env.JDOCMUNCH_DISABLED_TOOLS) env.JDOCMUNCH_DISABLED_TOOLS = ALL.filter((t) => !KEEP.has(t)).join(',');

const uvx = (process.env.USERPROFILE || '<HOME>') + '\\.cargo\\bin\\uvx.exe';
const child = spawn(uvx, ['jdocmunch-mcp'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => { console.error('[jdoc-launch]', e.message); process.exit(1); });
