export interface Patch {
    name: string;
    apply(): void;
}
