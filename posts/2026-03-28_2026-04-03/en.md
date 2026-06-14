Period: March 28, 2026 - April 3, 2026.

This week Voryn had one large but important refactor: the store layer became a repository layer.

From the outside, that may sound like renaming folders. In practice, it was a step toward a clearer architecture: interfaces describe what the pipeline needs, while PostgreSQL modules own how that data is stored and read.

What changed:

- replaced stores with repositories across interfaces, source code, and tests;
- split domain interfaces into clearer areas of responsibility;
- separated low-level PostgreSQL infrastructure from the repository layer;
- introduced dedicated repositories for the key parts of the pipeline;
- updated CLI wiring, runtime assembly, and workers for the new structure;
- expanded PostgreSQL repository and worker tests;
- updated the architecture documentation for the new separation.

The main idea of the week was naming the layers more honestly.

Store was too generic. In Voryn, these components do more than simply store data. They give the pipeline concrete operations: read a cursor, write a raw block, read canonical events, advance a worker cursor, and commit data inside a transaction. Repository became a better name for that role.

Another important part was separating interfaces from implementations.

The pipeline should not depend on PostgreSQL being underneath it. It needs clear contracts. The PostgreSQL side then implements those contracts through tables, transactions, advisory locks, and batched writes.

The other large part of the week was testing.

After a refactor like this, moving files is not enough. The workers still need to assemble correctly, start, stop, read state, and move the pipeline forward. That is why the tests around workers and the repository layer became much denser.

This week was about cleaning up the internal structure so the next changes would be easier to make without confusion.

Next post: what was built on top of this new structure.
