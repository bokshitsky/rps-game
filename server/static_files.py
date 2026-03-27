import os
import typing

from starlette.staticfiles import StaticFiles


class StaticFilesWithRewrites(StaticFiles):
    def __init__(
        self,
        *,
        rewrites: list[tuple[typing.Pattern, str]],
        directory: os.PathLike | None = None,
        packages: list[str | tuple[str, str]] | None = None,
        html: bool = False,
        check_dir: bool = True,
        follow_symlink: bool = False,
    ):
        self.rewrites = rewrites
        super().__init__(
            directory=directory,
            packages=packages,
            html=html,
            check_dir=check_dir,
            follow_symlink=follow_symlink,
        )

    def lookup_path(self, path: str) -> tuple[str, os.stat_result | None]:
        for pattern, replacement in self.rewrites:
            if pattern.match(path):
                return super().lookup_path(replacement)
        return super().lookup_path(path)
