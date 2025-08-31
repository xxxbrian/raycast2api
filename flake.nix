{
  description = "Development environment for raycast2api TypeScript project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Primary runtime - Bun (preferred for this project)
            bun

            # Node.js and npm for package management and fallback runtime
            nodejs_20

            # TypeScript compiler
            typescript

            # Essential development tools
            git
          ];

          shellHook = ''
            echo "🚀 raycast2api development environment loaded!"
            echo ""
            echo "Available tools:"
            echo "  • bun $(bun --version)"
            echo "  • node $(node --version)"
            echo "  • npm $(npm --version)"
            echo "  • tsc $(tsc --version)"
            echo ""
            echo "Quick start:"
            echo "  1. Install dependencies: npm install"
            echo "  2. Start dev server: bun run dev:local"
            echo ""
            echo "Health check endpoints will be available at:"
            echo "  • http://localhost:3000/health"
            echo "  • http://localhost:3000/ready"
            echo ""
            
            # Set NODE_ENV for development
            export NODE_ENV=development
            
            # Ensure npm uses the correct node version
            export npm_config_target_platform=$(uname -s | tr '[:upper:]' '[:lower:]')
            export npm_config_target_arch=$(uname -m)
          '';

          # Environment variables for the development shell
          NODE_ENV = "development";
        };
      });
}
