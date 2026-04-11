export type Project = {
	id: number;
	name: string;
	working_dir: string | null;
	context_path: string | null;
	evolution_config_dir: string | null;
	created_at: string;
	updated_at: string;
};
